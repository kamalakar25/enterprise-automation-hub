/**
 * Central event bus so workers can emit progress/log events that the HTTP
 * server forwards over Socket.io to the browser.
 */
import { EventEmitter } from 'events';

class SocketBus extends EventEmitter {}
// Increase default listener limit since many jobs may be running concurrently
SocketBus.defaultMaxListeners = 200;

export const bus = new SocketBus();

export default bus;
