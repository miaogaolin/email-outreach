/**
 * Smoke-test the built main.js outside Obsidian.
 *
 * It stubs the `obsidian` module just enough to evaluate the bundle and checks
 * that the plugin class is exported. This catches top-level errors such as a
 * missing base class or a broken module graph without needing the app.
 */
const Module = require("node:module");

class DummyClass {}

const obsidianStub = {
	Plugin: class Plugin {
		constructor() {
			this.app = {};
		}
		addRibbonIcon() {}
		addCommand() {}
		addSettingTab() {}
		registerView() {}
		registerEvent() {}
		registerBasesView() {
			return false;
		}
		async loadData() {
			return null;
		}
		async saveData() {}
	},
	ItemView: class ItemView {
		constructor() {
			this.app = {};
		}
	},
	Modal: class Modal {
		constructor() {
			this.app = {};
		}
	},
	PluginSettingTab: class PluginSettingTab {},
	Setting: DummyClass,
	Notice: class Notice {},
	TFile: class TFile {},
	TFolder: class TFolder {},
	TAbstractFile: DummyClass,
	WorkspaceLeaf: DummyClass,
	requestUrl: async () => ({ status: 200, json: {} }),
	normalizePath: (path) => path,
	setIcon: () => undefined,
	debounce: (fn) => fn,
	getLinkpath: (link) => link,
};

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
	if (request === "obsidian") return obsidianStub;
	return originalLoad.call(this, request, parent, isMain);
};

const plugin = require("../main.js");
const PluginClass = plugin && plugin.default ? plugin.default : plugin;

if (typeof PluginClass !== "function") {
	console.error("FAIL: main.js did not export a plugin class");
	process.exit(1);
}
console.log(`OK: main.js exports class ${PluginClass.name}`);
