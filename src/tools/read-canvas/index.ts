import { z } from "zod";
import { FileOperationResult } from "../../types.js";
import { promises as fs } from "fs";
import path from "path";
import { McpError } from "@modelcontextprotocol/sdk/types.js";
import { ensureCanvasExtension, validateVaultPath } from "../../utils/path.js";
import { fileExists } from "../../utils/files.js";
import { createCanvasNotFoundError, handleFsError, createInvalidJsonError } from "../../utils/errors.js";
import { createToolResponse, formatFileResult } from "../../utils/responses.js";
import { createTool } from "../../utils/tool-factory.js";

// Input validation schema for reading canvas files
const schema = z.object({
  vault: z.string()
    .min(1, "Vault name cannot be empty")
    .describe("Name of the vault containing the canvas"),
  filename: z.string()
    .min(1, "Filename cannot be empty")
    .refine(name => !name.includes('/') && !name.includes('\\'),
      "Filename cannot contain path separators - use the 'folder' parameter for paths instead")
    .describe("Just the canvas file name without path separators (e.g. 'my-canvas.canvas', NOT 'folder/my-canvas.canvas')"),
  folder: z.string()
    .optional()
    .refine(folder => !folder || !path.isAbsolute(folder),
      "Folder must be a relative path")
    .describe("Optional subfolder path relative to vault root")
}).strict();

type ReadCanvasInput = z.infer<typeof schema>;

// Result type includes parsed JSON content
type ReadCanvasResult = FileOperationResult & { content: Record<string, unknown> }; // Content is a parsed JSON object

async function readCanvas(
  vaultPath: string,
  filename: string,
  folder?: string
): Promise<ReadCanvasResult> {
  // Ensure the file has a .canvas extension
  const sanitizedFilename = ensureCanvasExtension(filename); // Need this helper in utils/path.js
  const fullPath = folder
    ? path.join(vaultPath, folder, sanitizedFilename)
    : path.join(vaultPath, sanitizedFilename);

  // Validate path is within vault
  validateVaultPath(vaultPath, fullPath);

  try {
    // Check if file exists
    if (!await fileExists(fullPath)) {
      // Use a specific error function for canvas files
      throw createCanvasNotFoundError(filename);
    }

    // Read the file content
    const rawContent = await fs.readFile(fullPath, "utf-8");

    // Parse the JSON content
    let parsedContent: Record<string, unknown>;
    try {
      parsedContent = JSON.parse(rawContent);
    } catch (parseError) {
      throw createInvalidJsonError(filename, parseError instanceof Error ? parseError.message : 'Unknown JSON parsing error');
    }

    return {
      success: true,
      message: "Canvas read and parsed successfully",
      path: fullPath,
      // Use 'edit' for now to match FileOperationResult type, like read-note
      operation: 'edit', 
      content: parsedContent // Return the parsed object
    };
  } catch (error: unknown) {
    if (error instanceof McpError) {
      throw error;
    }
    // Adapt error message context if needed
    throw handleFsError(error, 'read canvas');
  }
}

export function createReadCanvasTool(vaults: Map<string, string>) {
  return createTool<ReadCanvasInput>({
    name: "read-canvas",
    description: `Read and parse an Obsidian Canvas file (.canvas) from the vault. Returns the parsed JSON content according to the JSON Canvas spec (https://jsoncanvas.org/spec/1.0/).

Examples:
- Root canvas: { "vault": "myVault", "filename": "mind-map.canvas" }
- Canvas in subfolder: { "vault": "myVault", "filename": "project-plan.canvas", "folder": "projects/alpha" }`,
    schema,
    handler: async (args, vaultPath, _vaultName) => {
      const result = await readCanvas(vaultPath, args.filename, args.folder);

      // Format the file operation part of the result
      const formattedFileResult = formatFileResult({
        success: result.success,
        message: result.message,
        path: result.path,
        operation: result.operation
      });

      // Serialize the parsed JSON content back to a string for the response
      // Assumes the MCP expects a string response from createToolResponse
      const responseString = JSON.stringify(result.content, null, 2); // Pretty-print JSON

      // Combine the status message and the JSON string content
      return createToolResponse(
        `${formattedFileResult}\n\nCanvas Content:\n${responseString}`
      );
    }
  }, vaults);
} 