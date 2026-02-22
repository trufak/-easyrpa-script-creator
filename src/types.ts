export type CollectionType = {
  name: string;
  nodes: ExternalDataNodeType[];
}

export type ExternalDataNodeType = {
  name: string;
  label: { ru: string, en: string };
  collection: string;
  cid: string;
  parentsId: string[];
  type: NodeTypes;
  path: string;
  scriptPath: string;
  id: string;
  inputHandles: ExternalDataHandleType[];
  outputHandles: ExternalDataHandleType[];
  stateTerminals: ExternalDataStateTerminalType[];
  connectedEdges: ExternalDataEdgeType[];
  contentValues?: ContentValuesType,
  children?: ExternalDataNodeType[];
  dataSubFlow?: ExternalDataDefaultFlowType;
  scriptLineNumber?: number;
};

export type ExternalDataDefaultFlowType = {
  nodes: ExternalDataNodeType[];
  edges: ExternalDataEdgeType[];
};

export type ContentValuesType = { [key: string]: string | number | { [key: string]: string | number } | (string | number)[]};

export type ExternalDataEdgeType = {
  target: string;
  targetCid: string;
  targetHandle?: string;
  source: string;
  sourceCid: string;
  sourceHandle?: string;
  isReplacement: boolean;
};

export type ExternalDataStateTerminalType = {
  inputHandles: ExternalDataHandleType[];
  outputHandles: ExternalDataHandleType[];
  handlesType: HandleTypes;
  cid: string;
};

export type ExternalDataHandleType = {
  name: string;
  hidden: boolean;
  value: string;
  connectedEdges: ExternalDataEdgeType[];
  dataHandleSubFlowTerminal?: ExternalDataHandleType;
  nodeСid: string;
};

export enum HandleTypes {
  INPUT = 'input',
  OUTPUT = 'output'
}

export enum NodeTypes {
  CONTROL = 'control',
  CONTAINER = 'container',
  STATETERMINAL = 'stateTerminal',
  SUBFLOW = 'subFlow',
  EXTERNALSTATETERMINAL = 'externalStateTerminal'
}

export enum LanguageNames {
  RU = 'ru',
  EN = 'en'
};

export type VariablesNamesType = {
  nodesVariableName: string;
  containerDataName: string;
  nodesJsonVariableName: string;
  inputDictName: string;
  inHandlesName: string;
  defaultScriptName: string;
}

//тии мета-данных
export type MetaDataType = {
  appLanguage?: LanguageNames;
};

//типы для сортировки
export type EdgeSortedType = ExternalDataEdgeType & { visited?: boolean };
