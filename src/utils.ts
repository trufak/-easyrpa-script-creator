import { ExternalDataNodeType } from "./types";
import path from 'path';

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