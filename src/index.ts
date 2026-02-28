import fsPromises from "fs/promises";
import path from "path";

export interface IScriptCreator {
  createScript(
    dirPath: string,
    nodes: ExternalDataNodeType[],
    edges: ExternalDataEdgeType[],
    parentNode?: ExternalDataNodeType
  ): Promise<string>;
}

export type ScriptCreatorConfig = {
  logDebugVariablesPath?: string;
  metaData?: MetaDataType;
  isDebugMode?: boolean;
  isRunMode?: boolean;
  variablesNames?: Partial<VariablesNamesType>;
}

export class ScriptCreator implements IScriptCreator {
  metaData?: MetaDataType;
  isDebugMode?: boolean;
  isRunMode?: boolean;
  variablesNames: VariablesNamesType;
  logDebugVariablesPath?: string;
  handleGetCollections: ()=>Promise<CollectionType[]>;  

  constructor(
    handleGetCollections: ()=>Promise<CollectionType[]>,
    config?: ScriptCreatorConfig
  ) {
    this.logDebugVariablesPath = config?.logDebugVariablesPath;
    this.metaData = config?.metaData;
    this.isDebugMode = config?.isDebugMode;
    this.isRunMode = config?.isRunMode;
    this.variablesNames = {
      nodesVariableName: "nodes",
      containerDataName: "container_data",
      nodesJsonVariableName: "nodes_pickle",
      inputDictName: "input_dict",
      inHandlesName: "in_handles",
      defaultScriptName: "script.py",
      ...(config?.variablesNames || {}),
    };
    this.handleGetCollections = handleGetCollections;
  }

  //создание директории скрипта по заданному пути
  async createScript(
    dirPath: string,
    nodes: ExternalDataNodeType[],
    edges: ExternalDataEdgeType[],
    parentNode: ExternalDataNodeType | undefined = undefined
  ): Promise<string> {
    // проверяем наличие всех необходимых блоков
    const collections = await this.handleGetCollections();
    const allAvailableNodes = collections.reduce((allNodes: ExternalDataNodeType[], collection) => {
      return [
        ...allNodes,
        ...collection.nodes
      ]
    },[]);
    const nodesIsAvailable = nodes.every(node => allAvailableNodes.some(avNode => avNode.collection === node.collection && avNode.name === node.name));
    if (!nodesIsAvailable) {
      return Promise.reject('Some nodes are missing from collections');
    }
    // замена пути к директории блока 
    nodes.forEach(node=>{
      const availableNode = allAvailableNodes.find(avNode => avNode.collection === node.collection && avNode.name === node.name);
      if (availableNode) {
        node.path = availableNode.path;
      }
    });
    // сортировка узлов
    const nodesTree: ExternalDataNodeType[] = nodes.filter(
      (node: ExternalDataNodeType) =>
        !(node.parentsId && node.parentsId.length > 0)
    );
    const nodesSort: ExternalDataNodeType[] = this.topologicalSorting(
      nodesTree,
      edges
    );
    // копируем все директории узлов Control и Container
    const uniqueNodes: ExternalDataNodeType[] = nodes
      .filter(
        (node) =>
          node.type === NodeTypes.CONTROL || node.type === NodeTypes.CONTAINER
      )
      .filter(
        (
          node: ExternalDataNodeType,
          index: number,
          arr: ExternalDataNodeType[]
        ) => arr.findIndex((n) => n.name === node.name) === index
      );
    for (const node of uniqueNodes) {
      if (node.path && node.scriptPath && node.name) {
        await fsPromises.cp(
          path.join(node.path, path.dirname(normalize(node.scriptPath))),
          path.join(dirPath, node.name),
          { recursive: true }
        );
      } else {
        return Promise.reject(
          `Node ${node.name} incorrect: ${JSON.stringify(node)}`
        );
      }
    }
    //создаем скрипты для подсхем
    await this.createScriptSubFlows(nodes, dirPath);
    //записываем текст скрипта
    const scriptStr: string = this.createScriptString(
      nodes,
      nodesSort,
      edges,
      parentNode
    );
    const scriptPath: string = path.join(
      dirPath,
      this.variablesNames.defaultScriptName
    );
    await fsPromises.writeFile(scriptPath, scriptStr);

    return scriptPath;
  }
  //Вспомагательные методы
  //топологическая сортировка узлов одной иерархии
  private topologicalSorting(
    nodes: ExternalDataNodeType[],
    edges: ExternalDataEdgeType[]
  ): ExternalDataNodeType[] {
    const nodeTemp: ExternalDataNodeType[] = structuredClone(nodes);
    const edgeTemp: EdgeSortedType[] = structuredClone(edges);
    // Формирование списка опорных узлов, у которых нет входных линий либо входные линии находятся вне его родителя
    const supportNodes: ExternalDataNodeType[] = nodeTemp.filter((node) => {
      return !edgeTemp.some(
        (edge) =>
          edge.target === node.id &&
          nodeTemp.some((sourceNode) => sourceNode.id === edge.source)
      );
    });
    // Топологическая сортировка (с помощью обхода в глубину)
    const grayStack: ExternalDataNodeType[] = [];
    const blackStack: ExternalDataNodeType[] = [];
    supportNodes.forEach((supportNode) => {
      //Помещаем опорный узел в стек Gray
      grayStack.push(supportNode);
      //Поиск в глубину по узлам из стека Gray
      let n = 0;
      while (grayStack.length) {
        const firstNode = grayStack[n];
        if (firstNode) {
        //помещаем соседний узел в стек Gray
        const nextEdge: EdgeSortedType | undefined = edgeTemp.find(
          (edge) => !edge.visited && edge.source === firstNode.id
        );
        if (nextEdge) {
          nextEdge.visited = true;
          const nextNode: ExternalDataNodeType | undefined = nodeTemp.find(
            (node) => node.id === nextEdge.target
          );
          if (nextNode) {
            if (
              blackStack.find((node) => node.id === nextNode.id) ||
              grayStack.find((node) => node.id === nextNode.id)
            ) {
              n -= 1; // для перехода к этому же узлу
            } else {
              grayStack.push(nextNode);
            }
          } else {
            n -= 1; // для перехода к этому же узлу
          }
        } else {
          // Если это тупик, то помещаем firstNode в стек Black
          blackStack.push(firstNode);
          grayStack.splice(n, 1); // и удаляем firstNode из стека Gray
          n -= 2; // для перехода к предыдущему узлу
        }
        }
        n++;
      }
    });
    return blackStack.reverse();
  }
  //получение строки входных параметров функций узлов
  private getInputVars(node: ExternalDataNodeType): string {
    const inputVarsArray: string[] = [];
    //данные родительских контейнеров
    const isChild: boolean =
      node.parentsId?.length && node.parentsId.length > 0 ? true : false;
    isChild &&
      inputVarsArray.push(
        `"parent_data": ${this.variablesNames.containerDataName}`
      );
    //данные из линий, входящих в дескрипторы (переменные), или данные из настроек узла (текстовые константы)
    let inputHandlesVars: string[] = [];
    if (node.inputHandles && node.inputHandles.length !== 0) {
      inputHandlesVars = node.inputHandles.reduce(
        (result: string[], handle) => {
          if (handle.hidden) {
            //указание константы из настроек узла
            return [
              ...result,
              `"${handle.name}": ${handle.value ? `"${handle.value}"` : "None"
              }`,
            ];
          } else {
            if (handle.connectedEdges && handle.connectedEdges.length !== 0) {
              //указание переменной выходного узла связанной линии
              return [
                ...result,
                ...handle.connectedEdges
                  .filter((edge) => !edge.isReplacement)
                  .map(
                    (edge) =>
                      `"${handle.name}": ${this.variablesNames.nodesVariableName}["out_handles_${edge.sourceCid}"]["${edge.sourceHandle}"]`
                  ),
              ];
            } else {
              //указание None
              return [...result, `"${handle.name}": None`];
            }
          }
        },
        []
      );
    }
    inputVarsArray.push(
      `"${this.variablesNames.inHandlesName}": {${inputHandlesVars?.length > 0 ? inputHandlesVars.join(",") : ""
      }}`
    );
    const contentValues = `"content_values": ${node.contentValues && Object.keys(node.contentValues).length > 0
      ? JSON.stringify(node.contentValues)
      : "{}"
      }`;
    contentValues && inputVarsArray.push(contentValues);
    //лямбда функция дочерних блоков контейнеров
    let containerVars = "";
    if (node.type === NodeTypes.CONTAINER) {
      containerVars = this.getInputVarsForContainer(node, isChild);
    }
    containerVars && inputVarsArray.push(containerVars);
    //мета-данные
    if (this.metaData) {
      const metaDataVars = `"meta_data": {${Object.entries(this.metaData)
        .map(([key, value]) => `"${key}": "${value}"`)
        .join(",")}}`;
      inputVarsArray.push(metaDataVars);
    }
    //данные блока
    if (node.cid) {
      const nodeData: {
        id: string | number;
      } = {
        id: node.cid,
      };
      const nodeDataVars = `"node_data": {${Object.entries(nodeData)
        .map(([key, value]) => `"${key}": "${value}"`)
        .join(",")}}`;
      inputVarsArray.push(nodeDataVars);
    }

    return `{${inputVarsArray.join(",")}}`;
  }
  //получение строки входных параметров функций контейнеров
  private getInputVarsForContainer(
    container: ExternalDataNodeType,
    isChild: boolean
  ): string {
    const containerData = `{${isChild ? `**${this.variablesNames.containerDataName}, ` : ""
      }**data}`;
    return `"children": lambda data={}: ${container.cid}_children(${this.variablesNames.nodesVariableName},${containerData})`;
  }
  //создание функции контейнера
  private createScriptContainers(
    nodes: ExternalDataNodeType[],
    edges: ExternalDataEdgeType[],
    mainScriptArray: string[]
  ): void {
    nodes
      .filter((node) => node.type === NodeTypes.CONTAINER)
      .forEach((container) => {
        //название функции
        mainScriptArray.push(
          `def ${container.cid}_children(${this.variablesNames.nodesVariableName}, ${this.variablesNames.containerDataName}):`
        );
        //входные переменные
        //данные выходных терминалов
        const outputStateTerminals: ExternalDataStateTerminalType[] =
          container.stateTerminals?.filter(
            (terminal) => terminal.handlesType === HandleTypes.OUTPUT
          ) || [];
        if (outputStateTerminals.length > 0) {
          mainScriptArray.push("\t# data output terminals");
          outputStateTerminals.forEach((terminal) => {
            const terminalOutHandles: string[] =
              terminal.outputHandles?.map(
                (handle) =>
                  `"${handle.name}": ${this.variablesNames.containerDataName}["${handle.name}"]`
              ) || [];
            mainScriptArray.push(
              `\t${this.variablesNames.nodesVariableName}["out_handles_${terminal.cid
              }"] = {${terminalOutHandles.join(",")}}`
            );
          });
        }
        //функции дочерних узлов
        if (container.children) {
          mainScriptArray.push("\t# functions children nodes");
          const childrenSort: ExternalDataNodeType[] = this.topologicalSorting(
            container.children,
            edges
          );
          childrenSort.forEach((child) => {
            this.createCallNodeFunction(child, nodes, mainScriptArray);
          });
        }
        //данные входных терминалов
        const inputStateTerminals: ExternalDataStateTerminalType[] =
          container.stateTerminals?.filter(
            (terminal) => terminal.handlesType === HandleTypes.INPUT
          ) || [];
        if (inputStateTerminals.length > 0) {
          mainScriptArray.push("\t# data input terminals");
          inputStateTerminals.forEach((terminal) => {
            let inputHandlesVars: string[] = [];
            if (terminal.inputHandles && terminal.inputHandles.length !== 0) {
              inputHandlesVars = terminal.inputHandles.map((handle) => {
                const edge =
                  handle.connectedEdges && handle.connectedEdges.length > 0
                    ? handle.connectedEdges[0]
                    : null;
                return `"${handle.name}": ${edge
                  ? `${this.variablesNames.nodesVariableName}["out_handles_${edge.sourceCid}"]["${edge.sourceHandle}"]`
                  : "None"
                  }`;
              });
            }
            inputHandlesVars.length > 0 &&
              mainScriptArray.push(
                `\t${this.variablesNames.nodesVariableName}["out_handles_${terminal.cid
                }"] = {${inputHandlesVars.join(",")}}`
              );
          });
        }
        //выходные переменные
        const dataInputStateTerminals: string[] = inputStateTerminals.reduce(
          (result: string[], terminal) => {
            return [
              ...result,
              ...(terminal.inputHandles?.map(
                (handle) =>
                  `"${handle.name}": ${this.variablesNames.nodesVariableName}["out_handles_${terminal.cid}"]["${handle.name}"]`
              ) || []),
            ];
          },
          []
        );
        mainScriptArray.push(`\treturn {${dataInputStateTerminals.join(",")}}`);
      });
  }
  //создание функции подсхемы
  private async createScriptSubFlows(
    nodes: ExternalDataNodeType[],
    dirPath: string
  ): Promise<void> {
    const subFlows = nodes.filter((node) => node.type === NodeTypes.SUBFLOW);
    for (const subFlow of subFlows) {
      if (subFlow.dataSubFlow) {
        const dirName = getSubFlowName(subFlow);
        //создаем директорию блока подсхемы
        await fsPromises.mkdir(path.join(dirPath, dirName));
        //создаем скрипт
        await this.createScript(
          path.join(dirPath, dirName),
          subFlow.dataSubFlow.nodes,
          subFlow.dataSubFlow.edges,
          subFlow
        );
      }
    }
  }
  //создание строки вызова функции узла
  private createCallNodeFunction(
    node: ExternalDataNodeType,
    nodes: ExternalDataNodeType[],
    resultArray: string[],
    parentNode: ExternalDataNodeType | undefined = undefined
  ): void {
    const nodeName =
      node.type === NodeTypes.SUBFLOW ? getSubFlowName(node) : node.name;
    let functionCallString = "";
    if (node.type !== NodeTypes.EXTERNALSTATETERMINAL) {
      functionCallString = `\t${this.variablesNames.nodesVariableName
        }["out_handles_${node.cid}"] = main_${nodeName}(${this.getInputVars(
          node
        )})`;
    } else {
      //для внешних терминалов входных портов блок схемы
      let handleValues = "";
      if (parentNode) {
        handleValues = [
          ...(node.outputHandles?.map((handle) => {
            //поиск порта у родительского узла
            const parentHandle: ExternalDataHandleType | undefined =
              parentNode.inputHandles?.find((parentHandle) => {
                if (parentHandle.dataHandleSubFlowTerminal) {
                  if (
                    handle.nodeСid ===
                    parentHandle.dataHandleSubFlowTerminal.nodeСid
                  ) {
                    return (
                      handle.name ===
                      parentHandle.dataHandleSubFlowTerminal.name
                    );
                  }
                }
                return false;
              });
            if (parentHandle) {
              return `"${handle.name}": ${this.variablesNames.inputDictName}["${this.variablesNames.inHandlesName}"]["${parentHandle.name}"]`;
            }
            return `${handle.name}: None`;
          }) || []),
          ...(node.inputHandles?.map((handle) => {
            if (handle.connectedEdges && handle.connectedEdges.length !== 0) {
              //указание переменной выходного узла связанной линии
              const connectedEdge: ExternalDataEdgeType | undefined =
                handle.connectedEdges.find((edge) => !edge.isReplacement);
              if (connectedEdge) {
                return `"${handle.name}": ${this.variablesNames.nodesVariableName}["out_handles_${connectedEdge.sourceCid}"]["${connectedEdge.sourceHandle}"]`;
              }
            }
            return `"${handle.name}": None`;
          }) || []),
        ].join(",");
      } else {
        handleValues = [
          ...(node.outputHandles || []),
          ...(node.inputHandles || []),
        ]
          .map((handle) => `"${handle.name}": None`)
          .join(",");
      }
      functionCallString = `\t${this.variablesNames.nodesVariableName}["out_handles_${node.cid}"] = { ${handleValues} }`;
    }
    //формирование списка входящих линий
    const inputEdges: ExternalDataEdgeType[] = [
      ...(node.connectedEdges || []),
      ...(node.inputHandles || []).reduce<ExternalDataEdgeType[]>(
        (edges, handle) => {
          return [...edges, ...(handle.connectedEdges || [])];
        },
        []
      ),
    ];
    if (inputEdges.length > 0) {
      const sourceVariables: string[] = [];
      for (const edge of inputEdges) {
        const sourceNode: ExternalDataNodeType | undefined = nodes.find(
          (node) => node.id === edge.source
        );
        if (sourceNode) {
          if (edge.sourceHandle && sourceNode.outputHandles) {
            const sourceHandle: ExternalDataHandleType | undefined =
              sourceNode.outputHandles.find(
                (handle) => handle.name === edge.sourceHandle
              );
            if (sourceHandle) {
              sourceVariables.push(
                `${this.variablesNames.nodesVariableName}["out_handles_${edge.sourceCid}"] and ${this.variablesNames.nodesVariableName}["out_handles_${edge.sourceCid}"]["${edge.sourceHandle}"]`
              );
            }
          } else {
            sourceVariables.push(
              `${this.variablesNames.nodesVariableName}["out_handles_${edge.sourceCid}"]`
            );
          }
        }
      }
      if (sourceVariables.length > 0) {
        const outHandlesStopString =
          node.outputHandles && node.outputHandles.length > 0
            ? `{${node.outputHandles
              .map((handle) => `"${handle.name}": StopObject()`)
              .join(",")}}`
            : "StopObject()";
        resultArray.push(
          `\tif any(isinstance(x, StopObject) for x in [${sourceVariables.join(
            ","
          )}]):`
        );
        resultArray.push(
          `\t\t${this.variablesNames.nodesVariableName}["out_handles_${node.cid}"] = ${outHandlesStopString}`
        );
        resultArray.push(`\telse:`);
        resultArray.push(`\t${functionCallString}`);
      } else {
        resultArray.push(functionCallString);
      }
    } else {
      resultArray.push(functionCallString);
    }
    const foundNode: ExternalDataNodeType | undefined = nodes.find(
      (fnode) => fnode.cid === node.cid
    );
    if (foundNode) {
      foundNode.scriptLineNumber = resultArray.length;
    }
    this.isDebugMode &&
      resultArray.push(
        `\tlog_debug_variables(${this.variablesNames.nodesVariableName})`
      );
  }
  //создание текста скрипта
  private createScriptString(
    nodes: ExternalDataNodeType[],
    nodesSort: ExternalDataNodeType[],
    edges: ExternalDataEdgeType[],
    parentNode: ExternalDataNodeType | undefined
  ): string {
    const resultArray: string[] = [];
    //дополнение sys.path
    resultArray.push("# add script directory in sys.path");
    resultArray.push("import sys");
    resultArray.push("import os");
    resultArray.push(
      "sys.path.extend([d[0] for d in list(os.walk(os.path.dirname(__file__)))])"
    );
    resultArray.push("sys.stdout.reconfigure(encoding='utf-8')");
    //импорт для отладки
    if ((this.isDebugMode || this.isRunMode) && this.logDebugVariablesPath) {
      resultArray.push("import jsonpickle");
      resultArray.push("def log_debug_variables (variables):");
      resultArray.push("\tdef fail_safe_func(err):");
      resultArray.push("\t\treturn f'Unknown type'");
      resultArray.push(
        `\tvariables_pickle = jsonpickle.encode(variables, unpicklable=False, fail_safe=fail_safe_func)`
      );
      resultArray.push(
        `\twith open(${JSON.stringify(
          this.logDebugVariablesPath
        )}, "w") as file:`
      );
      resultArray.push("\t\tfile.write(variables_pickle)");
    }
    //импорт внутренних классов для формирования скриптов
    resultArray.push("from easy_module import StopObject");
    //формирование основного тела скрипта
    const nodesAndTerminals: (
      | ExternalDataNodeType
      | ExternalDataStateTerminalType
    )[] = [
        ...nodes,
        ...nodes
          .filter((node) => node.type === NodeTypes.CONTAINER)
          .reduce((terminals: ExternalDataStateTerminalType[], container) => {
            return [...terminals, ...(container.stateTerminals || [])];
          }, []),
      ];
    // Комментарий # import nodes functions
    resultArray.push("# import nodes functions");
    // Импорты скриптов узлов
    const importsNodesFunctions: string[] = nodes
      .filter(
        (
          node
        ): node is ExternalDataNodeType & {
          scriptPath: string;
          name: string;
          type: NodeTypes.CONTROL | NodeTypes.CONTAINER;
        } =>
          (node.type === NodeTypes.CONTROL ||
            node.type === NodeTypes.CONTAINER) &&
          node.scriptPath !== undefined &&
          node.name !== undefined
      )
      .filter(
        (node, index, arr) =>
          arr.findIndex((n) => n.name === node.name) === index
      )
      .map(
        (node) =>
          `from ${node.name}.${path.basename(
            normalize(node.scriptPath),
            ".py"
          )} import main as main_${node.name}`
      );
    resultArray.push(...importsNodesFunctions);
    //импорт скриптов подсхем
    const importsSubFlowFunctions: string[] = nodes
      .filter((node) => node.type === NodeTypes.SUBFLOW)
      .map(
        (subFlow) =>
          `from ${subFlow.name}_${subFlow.cid}.${path.basename(
            this.variablesNames.defaultScriptName || "script",
            ".py"
          )} import main as main_${subFlow.name}_${subFlow.cid}`
      );
    resultArray.push(...importsSubFlowFunctions);
    // Комментарий # container functions
    resultArray.push("# container functions");
    // Описание функций контейнеров с дочерними узлами
    this.createScriptContainers(nodes, edges, resultArray);
    // Комментарий # main function
    resultArray.push("# main function");
    // Описание функции main
    resultArray.push(`def main(${this.variablesNames.inputDictName}=None):`);
    // Комментарий # nodes variables
    resultArray.push("\t# nodes variables");
    // Переменные блоков
    const nodesVariables: string[] = nodesAndTerminals.map(
      (node) => `"out_handles_${node.cid}": None`
    );
    resultArray.push(
      `\t${this.variablesNames.nodesVariableName} = {${nodesVariables.join(
        ","
      )}}`
    );
    // Описание функций узлов первой иерархии
    resultArray.push("\t# functions nodes");
    nodesSort.forEach((node) => {
      //строка функции узла
      this.createCallNodeFunction(node, nodes, resultArray, parentNode);
    });
    //запись файла с переменными для режима Run
    this.isRunMode &&
      resultArray.push(
        `\tlog_debug_variables(${this.variablesNames.nodesVariableName})`
      );
    //возврат портов выходных внешних терминалов
    if (parentNode) {
      const returnedHandlesValues: string[] = nodes
        .filter((node) => node.type === NodeTypes.EXTERNALSTATETERMINAL)
        .reduce((returnedValues: string[], terminal) => {
          return [
            ...returnedValues,
            ...(terminal.inputHandles
              ?.map((handle) => {
                //поиск порта у родительского узла
                const parentHandle: ExternalDataHandleType | undefined =
                  parentNode.outputHandles?.find((parentHandle) => {
                    if (parentHandle.dataHandleSubFlowTerminal) {
                      if (
                        handle.nodeСid ===
                        parentHandle.dataHandleSubFlowTerminal.nodeСid
                      ) {
                        return (
                          handle.name ===
                          parentHandle.dataHandleSubFlowTerminal.name
                        );
                      }
                    }
                    return false;
                  });
                if (parentHandle) {
                  return `"${parentHandle.name}": ${this.variablesNames.nodesVariableName}["out_handles_${terminal.cid}"]["${handle.name}"]`;
                }
                return;
              })
              .filter((value): value is string => value !== undefined) || []),
          ];
        }, []);
      if (returnedHandlesValues.length > 0) {
        resultArray.push(`\treturn { ${returnedHandlesValues.join(",")} }`);
      }
    }
    // Комментарий # run main function
    resultArray.push("# run main function");
    // Строка запуска функции main
    resultArray.push(`if __name__ == "__main__":`);
    resultArray.push(`\tmain()`);

    return resultArray.join("\n");
  }
}

//types
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
  id: string | number;
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

//utils
//получение имени SubFLow
export const getSubFlowName = (
  subFlow: ExternalDataNodeType,
): string => {
  return `${subFlow.name}_${subFlow.cid}`;
};

export const normalize = (p: string): string => {
  return path.normalize(
    p.replaceAll('\\','/')
  )
};