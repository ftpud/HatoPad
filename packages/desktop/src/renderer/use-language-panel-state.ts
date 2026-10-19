import { useState } from "react";
import type {
  LanguageDescriptor,
  JavaBreakpoint,
  JavaDebugState,
  JavaProjectNode,
  JavaProjectOptions,
  RootedJavaDiagnostic,
} from "@hatopad/protocol";
import { type RunProject, type RunProjectProcess } from "./run-projects";

export function useLanguagePanelState() {
  const [languages, setLanguages] = useState<LanguageDescriptor[]>([]);

  const [runProjects, setRunProjects] = useState<RunProject[]>([]);

  const [runProjectProcesses, setRunProjectProcesses] = useState<Record<string, RunProjectProcess>>({});

  const [runProjectBusy, setRunProjectBusy] = useState(false);

  const [selectedLanguage, setSelectedLanguage] = useState<string>();

  const [javaOptions, setJavaOptions] = useState<JavaProjectOptions>();

  const [javaTree, setJavaTree] = useState<JavaProjectNode[]>([]);

  const [javaLog, setJavaLog] = useState("");

  const [javaRunning, setJavaRunning] = useState(false);

  const [javaDebugState, setJavaDebugState] = useState<JavaDebugState>({ status: "stopped", variables: [] });

  const [javaBreakpoints, setJavaBreakpoints] = useState<JavaBreakpoint[]>([]);

  const [javaPanelHeight, setJavaPanelHeight] = useState(240);

  const [problemsHeight, setProblemsHeight] = useState(220);

  const [javaDiagnostics, setJavaDiagnostics] = useState<RootedJavaDiagnostic[]>([]);

  const [javaChecking, setJavaChecking] = useState(false);
  return {
    languages,
    setLanguages,
    runProjects,
    setRunProjects,
    runProjectProcesses,
    setRunProjectProcesses,
    runProjectBusy,
    setRunProjectBusy,
    selectedLanguage,
    setSelectedLanguage,
    javaOptions,
    setJavaOptions,
    javaTree,
    setJavaTree,
    javaLog,
    setJavaLog,
    javaRunning,
    setJavaRunning,
    javaDebugState,
    setJavaDebugState,
    javaBreakpoints,
    setJavaBreakpoints,
    javaPanelHeight,
    setJavaPanelHeight,
    problemsHeight,
    setProblemsHeight,
    javaDiagnostics,
    setJavaDiagnostics,
    javaChecking,
    setJavaChecking,
  };
}
