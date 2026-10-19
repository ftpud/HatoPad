import path from 'node:path';
import {cloudOrigin} from './cloud.js';
import type {ManagedCloudCore} from './cloud-core-update.js';

/** Saved pairing identifies a managed workspace even after its process exits. */
export function matchLocalCloudCore(pairing: unknown, origin: string, coreId: string, workspaceId: string, target: string, coreMain?: string): ManagedCloudCore | undefined {
  if(!pairing || typeof pairing!=='object' || Array.isArray(pairing) || !/^[A-Za-z0-9_-]{1,200}$/.test(workspaceId)) return undefined;
  const identity=pairing as {hubUrl?:unknown;coreId?:unknown};
  try {if(identity.coreId!==coreId || typeof identity.hubUrl!=='string' || cloudOrigin(identity.hubUrl)!==origin) return undefined;} catch{return undefined;}
  const root=coreMain ? path.resolve(path.dirname(coreMain),'../../..') : undefined;
  const candidates=root ? [path.basename(root),path.basename(path.dirname(root))] : [];
  const release=candidates.find(value=>/^[a-f0-9]{40,64}-node[0-9]+(?:-repair-[a-zA-Z0-9]+|-bundle-[a-zA-Z0-9-]+)?$/.test(value));
  return {workspaceId,target,...(release?{release}:{})};
}
