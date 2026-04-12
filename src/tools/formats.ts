// TypeBox format registrations. Imported by tool wrappers to ensure URL
// validation actually fires on `Type.String({ format: "uri" })`.
import { FormatRegistry } from "@sinclair/typebox";

// Idempotent — FormatRegistry.Set overwrites prior registrations.
FormatRegistry.Set("uri", (value) => URL.canParse(value));
