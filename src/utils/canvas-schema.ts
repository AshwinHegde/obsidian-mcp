import { z } from "zod";

// Based on https://jsoncanvas.org/spec/1.0/

// Color schema (preset or hex)
const canvasColorSchema = z.union([
  z.enum(["1", "2", "3", "4", "5", "6"]), // Preset colors
  z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Must be a 6-digit hex color code starting with #") // Hex format
]);

// Generic node attributes
const genericNodeSchema = z.object({
  id: z.string().min(1),
  x: z.number().int(),
  y: z.number().int(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  color: canvasColorSchema.optional()
    .describe("Optional color (preset 1-6 or hex string)"),
}).strict();

// Text node
const textNodeSchema = genericNodeSchema.extend({
  type: z.literal("text"),
  text: z.string()
    .describe("Markdown text content"),
}).strict();

// File node
const fileNodeSchema = genericNodeSchema.extend({
  type: z.literal("file"),
  file: z.string().min(1)
    .describe("Path to the file (relative to vault)"),
  subpath: z.string().startsWith("#").optional()
    .describe("Optional subpath within the file (e.g., #heading)"),
}).strict();

// Link node
const linkNodeSchema = genericNodeSchema.extend({
  type: z.literal("link"),
  url: z.string().url()
    .describe("URL the node links to"),
}).strict();

// Group node
const groupNodeSchema = genericNodeSchema.extend({
  type: z.literal("group"),
  label: z.string().optional()
    .describe("Optional text label for the group"),
  background: z.string().optional()
    .describe("Optional path to a background image (relative to vault)"),
  backgroundStyle: z.enum(["cover", "ratio", "repeat"]).optional()
    .describe("Optional background image rendering style"),
}).strict();

// Discriminated union for all node types
const nodeSchema = z.discriminatedUnion("type", [
  textNodeSchema,
  fileNodeSchema,
  linkNodeSchema,
  groupNodeSchema
]);

// Edge schema
const edgeSchema = z.object({
  id: z.string().min(1),
  fromNode: z.string().min(1)
    .describe("ID of the node where the edge starts"),
  fromSide: z.enum(["top", "right", "bottom", "left"]).optional()
    .describe("Optional side where the edge connects on the 'from' node"),
  fromEnd: z.enum(["none", "arrow"]).optional()
    .describe("Optional shape of the edge endpoint at the start (default: none)"),
  toNode: z.string().min(1)
    .describe("ID of the node where the edge ends"),
  toSide: z.enum(["top", "right", "bottom", "left"]).optional()
    .describe("Optional side where the edge connects on the 'to' node"),
  toEnd: z.enum(["none", "arrow"]).optional()
    .describe("Optional shape of the edge endpoint at the end (default: arrow)"),
  color: canvasColorSchema.optional()
    .describe("Optional color for the edge line (preset 1-6 or hex string)"),
  label: z.string().optional()
    .describe("Optional text label for the edge"),
}).strict();

// Top-level canvas schema
export const canvasSchema = z.object({
  nodes: z.array(nodeSchema).optional()
    .describe("Optional array of nodes on the canvas"),
  edges: z.array(edgeSchema).optional()
    .describe("Optional array of edges connecting nodes"),
})
// Allow unknown keys at the top level for future compatibility/extensions?
// For now, let's keep it strict to the spec.
.strict("Canvas object must only contain 'nodes' and 'edges' properties");

// Type alias for convenience
export type CanvasData = z.infer<typeof canvasSchema>; 