import { z } from "zod";
import { promises as fs } from "fs";
import path from "path";
import { McpError } from "@modelcontextprotocol/sdk/types.js";
import { ensureCanvasExtension, validateVaultPath } from "../../utils/path.js";
import { fileExists, ensureDirectory } from "../../utils/files.js";
import { createCanvasNotFoundError, handleFsError } from "../../utils/errors.js"; // Use canvas error
import { createTool } from "../../utils/tool-factory.js";
import { createToolResponse } from "../../utils/responses.js";

// Input validation schema for deleting canvas files
const schema = z.object({
  vault: z.string()
    .min(1, "Vault name cannot be empty")
    .describe("Name of the vault containing the canvas"),
  // Use filename + folder for consistency with other canvas tools
  filename: z.string()
    .min(1, "Filename cannot be empty")
    .refine(name => !name.includes('/') && !name.includes('\\'), 
      "Filename cannot contain path separators - use the 'folder' parameter for paths instead")
    .describe("Just the canvas name without path separators (e.g. 'my-canvas.canvas')"),
  folder: z.string()
    .optional()
    .refine(folder => !folder || !path.isAbsolute(folder), 
      "Folder must be a relative path")
    .describe("Optional subfolder path relative to vault root"),
  reason: z.string()
    .optional()
    .describe("Optional reason for deletion (stored in trash metadata)"),
  permanent: z.boolean()
    .optional()
    .default(false)
    .describe("Whether to permanently delete instead of moving to trash (default: false)")
}).strict();

interface TrashMetadata {
  originalPath: string; // Relative path within vault
  deletedAt: string;
  reason?: string;
}

// Re-use from delete-note or keep local if structure differs slightly
async function ensureTrashDirectory(vaultPath: string): Promise<string> {
  const trashPath = path.join(vaultPath, ".trash");
  await ensureDirectory(trashPath);
  return trashPath;
}

// Adapted for canvas files (metadata as separate file)
async function moveCanvasToTrash(
  vaultPath: string,
  canvasRelativePath: string, // e.g., folder/my-canvas.canvas
  reason?: string
): Promise<string> {
  const trashPath = await ensureTrashDirectory(vaultPath);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const baseName = path.basename(canvasRelativePath, ".canvas");
  const trashName = `${baseName}_${timestamp}.canvas`;
  const trashFilePath = path.join(trashPath, trashName);
  const trashMetaPath = `${trashFilePath}.meta.json`; // Metadata sidecar file

  // Create metadata
  const metadata: TrashMetadata = {
    originalPath: canvasRelativePath,
    deletedAt: new Date().toISOString(),
    reason
  };

  try {
    // Move the actual canvas file
    await fs.rename(path.join(vaultPath, canvasRelativePath), trashFilePath);
    
    // Write metadata to separate JSON file
    await fs.writeFile(trashMetaPath, JSON.stringify(metadata, null, 2), 'utf8');

    return trashName;
  } catch (error) {
    // If rename fails, attempt to cleanup potential partial moves/metadata
    try { await fs.unlink(trashFilePath).catch(() => {}); } catch {} 
    try { await fs.unlink(trashMetaPath).catch(() => {}); } catch {} 
    throw handleFsError(error, 'move canvas to trash');
  }
}

async function deleteCanvas(
  vaultPath: string,
  canvasRelativePath: string, // e.g., folder/my-canvas.canvas
  options: {
    permanent?: boolean;
    reason?: string;
  } = {}
): Promise<string> {
  const fullPath = path.join(vaultPath, canvasRelativePath);

  // Validate path is within vault
  validateVaultPath(vaultPath, fullPath);

  try {
    // Check if canvas exists
    if (!await fileExists(fullPath)) {
      throw createCanvasNotFoundError(canvasRelativePath);
    }

    // OMITTING link updating logic from delete-note as it likely doesn't apply to canvas

    if (options.permanent) {
      // Permanently delete the file
      await fs.unlink(fullPath);
      return `Permanently deleted canvas "${canvasRelativePath}"`;
    } else {
      // Move to trash with metadata
      const trashName = await moveCanvasToTrash(vaultPath, canvasRelativePath, options.reason);
      return `Moved canvas "${canvasRelativePath}" to trash as "${trashName}"`;
    }
  } catch (error) {
    if (error instanceof McpError) {
      throw error;
    }
    throw handleFsError(error, 'delete canvas');
  }
}

type DeleteCanvasArgs = z.infer<typeof schema>;

export function createDeleteCanvasTool(vaults: Map<string, string>) {
  return createTool<DeleteCanvasArgs>({
    name: "delete-canvas",
    description: "Delete a canvas file (.canvas), moving it to .trash by default or permanently deleting if specified.",
    schema,
    handler: async (args, vaultPath, _vaultName) => {
      const sanitizedFilename = ensureCanvasExtension(args.filename);
      const canvasRelativePath = args.folder
        ? path.join(args.folder, sanitizedFilename)
        : sanitizedFilename;
      
      const resultMessage = await deleteCanvas(vaultPath, canvasRelativePath, { 
        reason: args.reason, 
        permanent: args.permanent 
      });
      
      // Use standard createToolResponse
      return createToolResponse(resultMessage);
    }
  }, vaults);
} 