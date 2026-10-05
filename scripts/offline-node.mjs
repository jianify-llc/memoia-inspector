// 依赖准备不受影响；仅测试子进程禁止真实出站连接，mock fetch 仍可替换。
import net from 'node:net';
import tls from 'node:tls';
import { syncBuiltinESMExports } from 'node:module';

let attempted = false;
process.on('exit', () => { if (attempted) process.exitCode = 1; });
function forbidden() {
  attempted = true;
  process.exitCode = 1;
  throw new Error('QUICK_NETWORK_FORBIDDEN');
}
net.Socket.prototype.connect = forbidden;
tls.connect = forbidden;
globalThis.fetch = forbidden;
syncBuiltinESMExports();
