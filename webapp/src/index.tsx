import {createReceiptComponent} from './ui';
import {Runtime} from './runtime';
import {styles} from './styles';
import {ID, Registry, Store} from './types';
class Plugin {
 private runtime?: Runtime;
 private registry?: Registry;
 private component?: string;
 private style?: HTMLStyleElement;
 initialize(registry: Registry,store: Store) {
  this.registry=registry;
  this.runtime=new Runtime(store);
  this.style=document.createElement('style');this.style.dataset.plugin=ID;this.style.textContent=styles;document.head.append(this.style);
  this.component=registry.registerPostMessageAttachmentComponent(createReceiptComponent(this.runtime));
 }
 uninitialize() {
  this.runtime?.stop();
  if (this.component) {this.registry?.unregisterComponent(this.component);}
  this.style?.remove();
 }
}
window.registerPlugin(ID,new Plugin());
