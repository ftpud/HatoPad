// Imported first by the Core entry point so legacy REMOTE_IDE_*/VIBE_* variables are mapped before any module reads its configuration.
import { applyLegacyEnvironmentWithWarning } from "@hatopad/protocol";
applyLegacyEnvironmentWithWarning(process.env);
