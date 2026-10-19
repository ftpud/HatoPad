export type JavaProjectOptions = {
  type: "maven";
  pomPath: string;
  mavenExecutable: string;
  javaHome?: string;
  mavenArguments?: string[];
  buildGoals?: string[];
  sourceRoots: string[];
  outputPath: string;
  testOutputPath: string;
  runConfigurations: JavaRunConfiguration[];
  selectedRunConfigurationId?: string;
};

export type JavaRunConfiguration = {
  id: string;
  name: string;
  mainClass: string;
  activeProfile?: string;
  programArguments?: string[];
  vmArguments?: string[];
  workingDirectory?: string;
  environmentFile?: string;
  environment?: Record<string, string>;
};

export type JavaToolCheck = {
  tool: "Maven" | "Java" | "Java compiler" | "Java debugger";
  executable: string;
  ok: boolean;
  message: string;
};

export const javaConfigurationPath = ".settings/java.json";

export type JavaMainClass = { className: string; path: string };

export type JavaBreakpoint = { path: string; line: number; className: string };

export type JavaDebugVariable = {
  name: string;
  value: string;
  reference?: string;
  type?: string;
  objectId?: string;
  indexedCount?: number;
};

export type JavaDebugState = {
  /** Workspace-relative source file for the current paused frame. */
  path?: string;
  status: "starting" | "running" | "paused" | "stopped";
  className?: string;
  method?: string;
  line?: number;
  variables: JavaDebugVariable[];
  applyingChanges?: boolean;
  inspectionError?: string;
  stopReason?: string;
};

export type JavaApplyChangesResult = {
  appliedClasses: string[];
  deferredClasses: string[];
  failedClasses: { className: string; message: string }[];
  restartRequired: boolean;
  warnings?: string[];
};

export type JavaDiagnostic = {
  path: string;
  line: number;
  column: number;
  severity: "error" | "warning";
  message: string;
};

export type JavaTypeSuggestion = { simpleName: string; qualifiedName: string; source: "project" | "dependency" };

export type JavaLspRange = { startLine: number; startColumn: number; endLine: number; endColumn: number };

export type JavaLspCompletion = {
  label: string;
  detail?: string;
  insertText: string;
  range?: JavaLspRange;
  additionalTextEdits: { range: JavaLspRange; text: string }[];
};

export type JavaLspLocation = { path: string } & JavaLspRange;

export type WorkspaceSymbol = {
  name: string;
  kind: number;
  path: string;
  line: number;
  column: number;
  container?: string;
};

export type RootedJavaDiagnostic = JavaDiagnostic & { rootId: string };

export type RootedJavaLspLocation = JavaLspLocation & { rootId: string };

export type RootedWorkspaceSymbol = WorkspaceSymbol & { rootId: string };

export type JavaSemanticToken = JavaLspRange & { type: string; modifiers: string[] };

export type JavaProjectNode = {
  name: string;
  path: string;
  type: "sourceRoot" | "package" | "file";
  sourceKind?: "source" | "test";
  javaType?: JavaFileType;
  children?: JavaProjectNode[];
};

export type JavaFileType = {
  kind: "class" | "interface" | "enum" | "record" | "annotation";
  abstract?: boolean;
  extends?: boolean;
  implements?: boolean;
};
