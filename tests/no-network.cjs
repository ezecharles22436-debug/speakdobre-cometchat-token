// Preload for offline checks. Individual tests may replace fetch with in-memory fakes.
const blocked = () => { throw new Error("External network is disabled for assessment tests."); };
globalThis.fetch = async () => blocked();
for (const moduleName of ["node:http", "node:https"]) {
  const transport = require(moduleName);
  transport.request = blocked;
  transport.get = blocked;
}
const net = require("node:net");
net.connect = blocked;
net.createConnection = blocked;
net.Socket.prototype.connect = blocked;
require("node:tls").connect = blocked;
