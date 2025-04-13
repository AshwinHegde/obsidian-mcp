import { z } from "zod";
import { promises as fs } from "fs";
import path from "path";
import { McpError } from "@modelcontextprotocol/sdk/types.js";
import { handleFsError } from "../../utils/errors.js";
import { createTool } from "../../utils/tool-factory.js";
import { createToolResponse } from "../../utils/responses.js"; // Needed for formatting response

// Input validation schema
const schema = z.object({
  vault: z.string()
    .min(1, "Vault name cannot be empty")
    .describe("Name of the vault to list files from"),
  // Optional: Add a 'subfolder' parameter later if needed
}).strict();

type ListFilesInput = z.infer<typeof schema>;

// Recursive function to get all file paths
async function listFilesRecursive(dirPath: string, vaultPath: string, ignored: Set<string>): Promise<string[]> {
  let files: string[] = [];
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    const promises = entries.map(async (entry) => {
      const fullPath = path.join(dirPath, entry.name);
      const relativePath = path.relative(vaultPath, fullPath);

      // Skip ignored folders/files and hidden files/folders
      if (ignored.has(entry.name) || entry.name.startsWith('.')) {
        return;
      }

      if (entry.isDirectory()) {
        // Recurse into subdirectory
        const subFiles = await listFilesRecursive(fullPath, vaultPath, ignored);
        files = files.concat(subFiles);
      } else if (entry.isFile()) {
        // Add file path (relative to vault root)
        files.push(relativePath);
      }
      // Ignore symbolic links, block devices, etc.
    });

    await Promise.all(promises);
  } catch (error) {
    // Allow errors like permission denied on subfolders, but log them
    // If the root vaultPath itself is inaccessible, the vaultResolver in createTool should handle it.
    console.error(`Error reading directory ${dirPath}: ${error instanceof Error ? error.message : String(error)}`);
    // We don't re-throw here to allow listing files from accessible parts of the vault
  }
  return files;
}

// Core function to initiate listing
async function listVaultFiles(vaultPath: string): Promise<string[]> {
  const ignored = new Set(['.obsidian', '.trash', 'node_modules']); // Add other common ignored names if necessary
  try {
    const allFiles = await listFilesRecursive(vaultPath, vaultPath, ignored);
    allFiles.sort(); // Sort alphabetically
    return allFiles;
  } catch (error) {
    // Handle potential errors at the top level (e.g., vaultPath doesn't exist)
    if (error instanceof McpError) {
      throw error;
    }
    throw handleFsError(error, 'list vault files');
  }
}

// Tool factory
export function createListFilesTool(vaults: Map<string, string>) {
  return createTool<ListFilesInput>({
    name: "list-files",
    description: "Recursively lists all non-hidden files within the specified vault, showing their full paths relative to the vault root.",
    schema,
    handler: async (args, vaultPath, _vaultName) => {
      const files = await listVaultFiles(vaultPath);
      
      const responseText = files.length > 0 
        ? `Files in vault "${args.vault}":\n${files.join('\n')}`
        : `No files found in vault "${args.vault}".`;

      return createToolResponse(responseText);
    }
  }, vaults);
} 