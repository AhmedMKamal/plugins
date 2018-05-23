/// <reference path="./store.ts" />
/// <reference path="../common/util.ts" />
/*
 * Resolve remote plugins into configurable objects and save/load this configuration
 * so it persists across chrome sessions.
 */
import { flatten, pick, find } from "lodash";
import { StoreSynced, } from "./store";
import { promisify, instanceOfDynamicMatch } from "../common/util";
// HACKY
// Force PluginBase, PluginTranslation class to be included so that eval doesn't bitch
let { PluginBase } = require("../common/plugin-lib");

// Plugin content-script store for easily loading front-end
// code into pages
interface IPluginCSStore extends IDisableable {
    match: RegExp[],
    cs: string,
    // if it has at least 1 global command
    hasGlobalCmd: boolean,
}

export class PluginManager extends StoreSynced {
    private pluginsCSStore:IPluginCSStore[];

    protected storeUpdated(newOptions: IOptions) {
        this.pluginsCSStore = newOptions.plugins.map(pluginConfig =>
            ({
                hasGlobalCmd: !!find(pluginConfig.commands, cmd => cmd.global),
                ...pick(pluginConfig, ['enabled', 'cs', 'match']),
            }));
    }

    // checks the given url and returns the plugin cs code for it
    // used to work with chrome.tabs.executeScript(tabId)... but eval'ing
    // on the page CS is cleaner
    async getPluginCSCode(url: string): Promise<string> {
        // make sure at least the initial load has happened
        await this.initialLoad;
        // either matches the url, or has at least one global
        let compiledCsStr = this.pluginsCSStore
            .filter(plugin => plugin.enabled && (plugin.hasGlobalCmd || plugin.match.reduce((acc, matchPattern) => acc || matchPattern.test(url), false)))
            .map(plugin => plugin.cs).join('\n');
		// can't promisify here because we need to access lastError
        // return `${typeof this.initialLoad} ${this.initialLoad} ${JSON.stringify(this.initialLoad)}`;
        return compiledCsStr;
    }

    // Take PluginBase subclass and
    // put into form ready for the plugin store
    // only needs to be run when plugin version is changed
    // (most commonly when fetching new plugins, or updating version of
    // existing plugins)
    static async digestNewPlugin(id: string, version: string): Promise<ILocalPluginData> {
        let pluginModule = PluginManager.evalPluginCode(id, (await PluginManager.fetchPluginCode(id)));
        let plugin = pluginModule.Plugin;
        let csCmdsStr = plugin.commands
                .filter((cmd) => cmd.runOnPage)
                .map((cmd) => {
                    let cmdVal:any = {
                        runOnPage: cmd.runOnPage.toString(),
                    };
                    if (instanceOfDynamicMatch(cmd.match)) {
                        let dynMatchFns = [`en: ${cmd.match.fn.toString()}`];
                        // add other languages
                        for (let ln in pluginModule.languages) {
                            dynMatchFns.push(`${ln}: ${pluginModule.languages[ln].commands[cmd.name].match.fn.toString()}`);
                        }
                        cmdVal.match = `{${dynMatchFns.join(',')}}`
                    }
                    let cmdValStr = Object.keys(cmdVal).map((key) => `${key}:${cmdVal[key]}`).join(',');
                    return `'${cmd.name}': {${cmdValStr}}`
                });
        // members that the plugin uses internally (shared across commands)
        let privateMembers = Object.keys(plugin)
                .filter((member) => typeof PluginBase[member] === 'undefined')
                .map((member) => {
                    let val = plugin[member];
                    let _type = typeof val;
                    if (_type === 'function')
                        val = val.toString()
                    else if (_type === 'object') {
                        if (plugin[member] instanceof Set) {
                            val = `new Set(${JSON.stringify(Array.from(plugin[member]))})`
                        } else {
                            val = JSON.stringify(plugin[member]);
                        }
                    } else if (_type === 'string') {
                        // wrap it up
                        val = ['`', val, '`'].join('');
                    }
                    return `Plugin.${member} = ${val};`
                });
        let autoGenerated = `Plugin.getOption = function(name) { return PluginBase.getOption('${id}', name); };
                             Plugin.setOption = function(name, val) { return PluginBase.setOption('${id}', name, val); };`;
        // make reg fn into a arrow fn
        let initAndDestrStr = ['init', 'destroy'].map(x => plugin[x] ? `Plugin.${x}=${plugin[x].toString().replace(/(.*)\(\s*\)\s*{/, '()=>{')}` : '').join(';');
        // IIFE
        let cs = `allPlugins.${id}Plugin = (function(){class Plugin {};
                Plugin.commands = {${csCmdsStr.join(',')}};
                ${privateMembers.join('\n')}
                ${autoGenerated}
                ${initAndDestrStr}; return Plugin;})()`;
        return {
            commands: plugin.commands.map((cmd) => {
                let delay;
                if (cmd.delay)
                    delay = flatten([cmd.delay]);
                return {
                    // Make all the functions strings (because we can't store them directly)
                    match: instanceOfDynamicMatch(cmd.match) ? cmd.match : flatten([cmd.match]),
                    delay,
                    // don't pick test... perhaps others (so we whitelist)
                    ... pick(cmd, 'run', 'name', 'description', 'nice', 'global',),
                };
            }),
            languages: ["en", ...<LanguageCode[]>Object.keys(pluginModule.languages)],
            match: flatten([plugin.match]),
            cs,
            version,
            ... pick(plugin, 'niceName', 'homophones')
        };
    }

    static evalPluginCode(id: string, text: string): {Plugin: typeof PluginBase, languages: {[L in LanguageCode]: typeof PluginTranslationBase}} {
        let pluginModule;
        // HACK
        // needed to prevent undefined error in common (init) code
        // TODO: load plugin code in frontend --> send up the properties
        // that must be stored (as strings if they have things undefined
        // in the bg (get eval'd in the cs)). This way we don't have
        // to define dumby PluginUtil shit here
        // takes ~1ms

        let $ = () => { return {ready: () => null}};
        class PluginTranslationBase {};
        try {
            eval(`${text}; pluginModule = ${id}Plugin;`);
        } catch (e) {
            console.error(e);
            console.error(`Error eval'ing ${id}. Skipping.`);
        }
        // END HACK
        pluginModule.languages = pluginModule.languages || {};

        return pluginModule;
    }

    // TODO: when ES6 System.import is supported, switch to using that?
    // load options
    // Needs to be public to keep this testable
    static fetchPluginCode(id: string): Promise<string>  {
        return new Promise((resolve, reject) => {
            let plugin: typeof PluginBase;
            let request = new XMLHttpRequest();
            request.open('GET', chrome.runtime.getURL(`dist/plugins/${id.toLowerCase()}.js`), true);

            request.onload = () => {
                if (request.status >= 200 && request.status < 400) {
                    resolve(request.responseText);
                } else {
                    // We reached our target server, but it returned an error
                    reject();
                }
            };

            request.onerror = function() {
                // There was a connection error of some sort
            };

            request.send();
        });
    }
}
