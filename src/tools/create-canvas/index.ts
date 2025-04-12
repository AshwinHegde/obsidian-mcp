import { z } from "zod";
import { FileOperationResult } from "../../types.js";
import { promises as fs } from "fs";
import path from "path";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { ensureCanvasExtension, validateVaultPath } from "../../utils/path.js";
import { ensureDirectory, fileExists } from "../../utils/files.js";
// Need createCanvasExistsError
import { createCanvasExistsError, handleFsError, createInvalidJsonError } from "../../utils/errors.js"; 
import { createToolResponse, formatFileResult } from "../../utils/responses.js";
import { createTool } from "../../utils/tool-factory.js";
// Import the canvas spec schema
import { canvasSchema } from "../../utils/canvas-schema.js";

// Input validation schema for creating canvas files
const schema = z.object({
  vault: z.string()
    .min(1, "Vault name cannot be empty")
    .describe("Name of the vault to create the canvas in"),
  filename: z.string()
    .min(1, "Filename cannot be empty")
    .refine(name => !name.includes('/') && !name.includes('\\'), 
      "Filename cannot contain path separators - use the 'folder' parameter for paths instead. Example: use filename:'canvas.canvas', folder:'my/path' instead of filename:'my/path/canvas.canvas'")
    .describe("Just the canvas name without path separators (e.g. 'my-canvas.canvas', NOT 'folder/my-canvas.canvas'). Will add .canvas extension if missing"),
  content: z.string()
    // Use safeParse against the canvasSchema for better upfront validation
    .refine(content => {
      try {
        const parsed = JSON.parse(content);
        // Check structure against the canvas schema
        return canvasSchema.safeParse(parsed).success;
      } catch {
        return false; // Not even valid JSON
      }
    }, "Content must be a valid JSON string conforming to the JSON Canvas spec (https://jsoncanvas.org/spec/1.0/)")
    .describe("Content of the canvas as a valid JSON string (conforming to JSON Canvas spec)"),
  folder: z.string()
    .optional()
    .refine(folder => !folder || !path.isAbsolute(folder), 
      "Folder must be a relative path")
    .describe("Optional subfolder path relative to vault root (e.g. 'projects/boards'). Use this for the path instead of including it in filename")
}).strict();

type CreateCanvasInput = z.infer<typeof schema>;

async function createCanvas(
  args: CreateCanvasInput,
  vaultPath: string
): Promise<FileOperationResult> {
  const sanitizedFilename = ensureCanvasExtension(args.filename);

  const canvasPath = args.folder
    ? path.join(vaultPath, args.folder, sanitizedFilename)
    : path.join(vaultPath, sanitizedFilename);

  // Validate path is within vault
  validateVaultPath(vaultPath, canvasPath);

  try {
    // Parse and validate the content against the spec *before* any file operations
    let parsedContent: any;
    try {
      parsedContent = JSON.parse(args.content);
      // Rigorous check using parse (throws detailed error on failure)
      canvasSchema.parse(parsedContent); 
    } catch (error: unknown) {
      if (error instanceof z.ZodError) {
        // Convert Zod error to McpError
        throw new McpError(
          ErrorCode.InvalidParams,
          `Invalid canvas JSON structure: ${error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`
        );
      } else {
        // Handle plain JSON parsing error
        throw createInvalidJsonError(sanitizedFilename, error instanceof Error ? error.message : 'Unknown JSON parsing error');
      }
    }
    
    // Create directory structure if needed
    const canvasDir = path.dirname(canvasPath);
    await ensureDirectory(canvasDir);

    // Check if file exists first
    if (await fileExists(canvasPath)) {
      // Use the new error for canvas files
      throw createCanvasExistsError(canvasPath);
    }

    // File doesn't exist, proceed with creation. Write the original string content.
    await fs.writeFile(canvasPath, args.content, 'utf8');
    
    return {
      success: true,
      message: "Canvas created successfully",
      path: canvasPath,
      operation: 'create'
    };
  } catch (error) {
    if (error instanceof McpError) {
      throw error;
    }
    throw handleFsError(error, 'create canvas');
  }
}

export function createCreateCanvasTool(vaults: Map<string, string>) {
  return createTool<CreateCanvasInput>({
    name: "create-canvas",
    description: `Create a new canvas file (.canvas) in the specified vault with JSON content conforming to the JSON Canvas spec (https://jsoncanvas.org/spec/1.0/).

Examples:
- Root canvas: { "vault": "vault1", "filename": "my-board.canvas", "content": "{\"nodes\":[],\"edges\":[]}" }
- Canvas in subfolder: { "vault": "vault2", "filename": "project-plan.canvas", "folder": "projects", "content": "{\"nodes\":[{\"id\":\"node1\",\"type\":\"text\",\"text\":\"Initial idea\",\"x\":100,\"y\":100,\"width\":150,\"height\":50}],\"edges\":[]}" }`,
    schema,
    handler: async (args, vaultPath, _vaultName) => {
      // Validation (including schema structure) is now handled by the input schema refine and the core createCanvas function
      const result = await createCanvas(args, vaultPath);
      return createToolResponse(formatFileResult(result));
    }
  }, vaults);
} 