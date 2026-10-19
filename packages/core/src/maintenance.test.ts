import {it,expect,vi} from 'vitest';
import {once} from 'node:events';
import {execFileSync} from 'node:child_process';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {WebSocket} from 'ws';
import {createServer,shutdownCore} from './server.js';
import {CoreUpdates} from './core-update.js';
import {WorkspaceFileSystem} from './filesystem.js';

it('keeps incompatible authenticated maintenance sessions isolated from workspace services and rejects unauthenticated updates',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'core-maintenance-'));const sockets:WebSocket[]=[];
  vi.stubEnv('HATOPAD_STATE_DIR',path.join(root,'state'));const workspace=path.join(root,'workspace');await mkdir(workspace);execFileSync("git",["init","-q",workspace]);
  const updates=new CoreUpdates();const check=vi.spyOn(updates,'check');const initialize=vi.spyOn(WorkspaceFileSystem.prototype,'initialize');
  const token='a'.repeat(64);const server=await createServer('127.0.0.1',0,workspace,{access:{token},updates});
  initialize.mockClear();
  const address=server.address();if(!address||typeof address==='string')throw Error('No address');
  const connect=async()=>{const socket=new WebSocket(`ws://127.0.0.1:${address.port}`);sockets.push(socket);await once(socket,'open');return socket;};
  let sequence=0;const request=async(socket:WebSocket,type:string,payload:unknown)=>{const id=String(++sequence);const response=once(socket,'message');socket.send(JSON.stringify({id,type,payload}));return JSON.parse(String((await response)[0]));};
  try {
    const denied=await connect();expect(await request(denied,'protocol.maintenance',{compatibility:{minimum:20,maximum:20}})).toMatchObject({ok:false});
    const socket=await connect();expect(await request(socket,'protocol.maintenance',{token,compatibility:{minimum:20,maximum:20}})).toMatchObject({ok:true,result:{compatible:false,maintenance:true}});
    expect(await request(socket,'core.update.check',{branch:'dev'})).toMatchObject({ok:true,result:{available:false}});
    expect(check).toHaveBeenCalledWith({branch:'dev'},false,{minimum:20,maximum:20});
    for(const type of ['workspace.roots','workspace.open','terminal.create','tasks.create','portTunnel.open']) expect(await request(socket,type,{})).toMatchObject({ok:false,error:{code:'INVALID_REQUEST'}});
    expect(await request(socket,'protocol.keepAlive',{})).toMatchObject({ok:true});
    expect(initialize).not.toHaveBeenCalled();
    // Rejected normal handshakes and immediate disconnects must not kill Core.
    for(let index=0;index<4;index++) {const rejected=await connect();expect(await request(rejected,'protocol.handshake',{token,compatibility:{minimum:20,maximum:20}})).toMatchObject({ok:true,result:{compatible:false}});rejected.close();}
    for(let index=0;index<3;index++) {const abandoned=await connect();expect(await request(abandoned,'protocol.handshake',{token,compatibility:{minimum:19,maximum:19}})).toMatchObject({ok:true,result:{compatible:true}});abandoned.terminate();}
    expect(await request(socket,'protocol.keepAlive',{})).toMatchObject({ok:true});
  } finally {for(const socket of sockets)socket.terminate();await shutdownCore(server);vi.restoreAllMocks();vi.unstubAllEnvs();await rm(root,{recursive:true,force:true});}
},20_000);
