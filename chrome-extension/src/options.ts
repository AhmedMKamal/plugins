/// <reference path="./background/store.ts" />
/*
 * Included in the options.html script
 */
import riot from 'riot';
import { pick, omit }  from "lodash";
import { Store, StoreSynced, IOptions } from "./background/store";
require('./tags/options-page.tag');

// what's shown on the options page
interface IPluginOptionsPageStore extends IGeneralOptions {
    cmdGroups: IPluginPref[]
}

interface IPluginPref {
    expanded: boolean,
    enabled: boolean,
    id: string,
    friendlyName: string,
    version: string,
    commands: ICommandPref[]
    description?: string,
    homophones?: IHomophonePref[]
}

interface ICommandPref {
    enabled: boolean,
    name: string,
    match: string | string[],
    description?: string,
}

interface IHomophonePref {
    enabled: boolean,
    source: string,
    destination: string,
}


class OptionsPage extends StoreSynced {
    constructor(store: Store, private options: IPluginOptionsPageStore = <IPluginOptionsPageStore>{}) {
        super(store);
        riot.observable(this.options);
        riot.mount('options-page', {store: this.options});
    }

    storeUpdated(newOptions: IOptions) {
        Object.assign(this.options,  {
            ... omit(newOptions, 'plugins'),
            cmdGroups: newOptions.plugins.map(plugin => ({
                    commands: plugin.commands.map(cmd => ({
                        match: typeof cmd.match !== 'function' ? cmd.match : '',
                        ... pick(cmd, 'enabled', 'name', 'description'),
                    })),
                    ... pick(plugin, 'version', 'expanded', 'enabled', 'friendlyName', 'id', 'description', 'homophones'),
            })),
        });
        // trigger exists once we call riot.observable
        (this.options as any).trigger('update', this.options);
    }

    save() {
        // @ts-ignore: omit takes out cmdGroups
        this.store.save({
            ... omit(this.options, 'cmdGroups'),
            plugins: this.options.cmdGroups.reduce((memo, cmdGroup) => {
                memo[cmdGroup.id] = {
                    disabledCommands: cmdGroup.commands.filter(x => !x.enabled).map(cmd => cmd.name),
                    disabledHomophones: cmdGroup.homophones.filter(x => !x.enabled).map(homo => homo.source),
                    ... pick(cmdGroup, 'version', 'expanded', 'enabled'),
                };
                return memo;
            }, {}),
        });
    }

    reset() {
        this.store.resetPreferences();
    }
}


let store = new Store();
let options = new OptionsPage(store);


// so riot can access the options as well
window['options'] = options;
