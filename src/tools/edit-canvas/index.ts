import { z } from "zod";
import { FileOperationResult } from "../../types.js";
import { promises as fs } from "fs";
import path from "path";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { ensureCanvasExtension, validateVaultPath } from "../../utils/path.js";
import { fileExists } from "../../utils/files.js";
import { createCanvasNotFoundError, handleFsError, createInvalidJsonError } from "../../utils/errors.js";
import { createToolResponse, formatFileResult } from "../../utils/responses.js";
import { createTool } from "../../utils/tool-factory.js";
// Import the canvas spec schema
import { canvasSchema } from "../../utils/canvas-schema.js";

// Input validation schema for editing canvas files
const schema = z.object({
  vault: z.string()
    .min(1, "Vault name cannot be empty")
    .describe("Name of the vault containing the canvas"),
  filename: z.string()
    .min(1, "Filename cannot be empty")
    .refine(name => !name.includes('/') && !name.includes('\\'), 
      "Filename cannot contain path separators - use the 'folder' parameter for paths instead")
    .describe("Just the canvas name without path separators (e.g. 'my-canvas.canvas', NOT 'folder/my-canvas.canvas'). Will add .canvas extension if missing"),
  folder: z.string()
    .optional()
    .refine(folder => !folder || !path.isAbsolute(folder), 
      "Folder must be a relative path")
    .describe("Optional subfolder path relative to vault root"),
  operation: z.literal('replace') // Only replace is supported for canvas JSON
    .describe("Must be 'replace' to overwrite the entire canvas content"),
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
    .describe("New content for the canvas as a valid JSON string (conforming to JSON Canvas spec)")
}).strict();

type EditCanvasInput = z.infer<typeof schema>;

async function editCanvas(
  vaultPath: string, 
  filename: string,
  content: string, // Operation is always 'replace'
  folder?: string
): Promise<FileOperationResult> {
  const sanitizedFilename = ensureCanvasExtension(filename);
  const fullPath = folder
    ? path.join(vaultPath, folder, sanitizedFilename)
    : path.join(vaultPath, sanitizedFilename);
  
  // Validate path is within vault
  validateVaultPath(vaultPath, fullPath);

  // Create unique backup filename
  const timestamp = Date.now();
  const backupPath = `${fullPath}.${timestamp}.backup`;

  try {
    // Check if file exists before attempting edit
    if (!await fileExists(fullPath)) {
      throw createCanvasNotFoundError(sanitizedFilename);
    }
    
    // Parse and validate the content against the spec *before* any file operations
    let parsedContent: any;
    try {
      parsedContent = JSON.parse(content);
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

    // Create backup before replacing
    await fs.copyFile(fullPath, backupPath);

    try {
      // Write the new content (replace operation)
      await fs.writeFile(fullPath, content, 'utf8');
      
      // Clean up backup on success
      await fs.unlink(backupPath);

      return {
        success: true,
        message: `Canvas replaced successfully`,
        path: fullPath,
        operation: 'edit' // Using 'edit' as per existing FileOperationResult type
      };
    } catch (writeError: unknown) {
      // On write error, attempt to restore from backup
      if (await fileExists(backupPath)) {
        try {
          await fs.copyFile(backupPath, fullPath);
          await fs.unlink(backupPath);
          console.error(`Restored canvas ${fullPath} from backup after write error.`);
        } catch (rollbackError: unknown) {
          const writeErrorMessage = writeError instanceof Error ? writeError.message : String(writeError);
          const rollbackErrorMessage = rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
          
          // Throw a more specific error indicating restore failure but preserving backup
          throw new McpError(
            ErrorCode.InternalError,
            `Failed to rollback canvas changes after write error. Original error: ${writeErrorMessage}. Rollback error: ${rollbackErrorMessage}. Backup file preserved at ${backupPath}`
          );
        }
      }
      // Re-throw the original write error if rollback was successful or backup didn't exist
      throw writeError;
    }
  } catch (error: unknown) {
    // General catch block: if a backup exists, try to remove it as the operation failed before writing
    // or if rollback failed in the inner catch.
    // Check if it still exists because the inner catch might have removed it on successful rollback
    if (await fileExists(backupPath)) { 
      try {
        await fs.unlink(backupPath);
      } catch (cleanupError: unknown) {
        console.error(`Failed to cleanup backup file ${backupPath} during error handling: ${cleanupError}`);
      }
    }

    if (error instanceof McpError) {
      throw error;
    }
    throw handleFsError(error, 'edit canvas'); 
  }
}

export function createEditCanvasTool(vaults: Map<string, string>) {
  return createTool<EditCanvasInput>({
    name: "edit-canvas",
    description: `Edit an existing canvas file (.canvas) in the specified vault by replacing its content with JSON conforming to the JSON Canvas spec (https://jsoncanvas.org/spec/1.0/).

    The operation must be 'replace'. Append/prepend are not supported for JSON canvas files.

Examples:
- Replace canvas in root: { "vault": "vault1", "filename": "my-board.canvas", "operation": "replace", "content": "{\"nodes\":[{\"id\":\"new_node\"...}],\"edges\":[]}" }
- Replace canvas in subfolder: { "vault": "vault2", "filename": "project-plan.canvas", "folder": "projects", "operation": "replace", "content": "{\"nodes\":[],\"edges\":[]}" }`,
    schema,
    handler: async (args, vaultPath, _vaultName) => {
      // Validation (including schema structure) is now handled by the input schema refine and the core editCanvas function
      const result = await editCanvas(
        vaultPath, 
        args.filename, 
        args.content, 
        args.folder
      );
      return createToolResponse(formatFileResult(result));
    }
  }, vaults);
} 