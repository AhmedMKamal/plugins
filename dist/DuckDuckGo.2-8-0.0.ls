import PluginBase from 'chrome-extension://lnnmjmalakahagblkkcnjkoaihlfglon/dist/modules/plugin-base.js';import ExtensionUtil from 'chrome-extension://lnnmjmalakahagblkkcnjkoaihlfglon/dist/modules/extension-util.js';var DuckDuckGo_280_backend_resolved = {...PluginBase,niceName:"DuckDuckGo",languages:{},description:"The duckduckgo search engine.",version:"2.8.0",match:/.*/,homophones:{search:"duck"},authors:"Aparajita Fishman",commands:[{name:"Search",description:"Do a duckduckgo search.",global:!0,match:"duck *",fn:async(transcript,searchQuery)=>{chrome.tabs.create({url:`https://duckduckgo.com/?q=${searchQuery}`,active:!0});}}]};

export default DuckDuckGo_280_backend_resolved;LS-SPLITallPlugins.DuckDuckGo = (() => { var DuckDuckGo_280_0_matching_cs_resolved = {...PluginBase,commands:{Search:{}}};

return DuckDuckGo_280_0_matching_cs_resolved;
 })()LS-SPLITallPlugins.DuckDuckGo = (() => { var DuckDuckGo_280_0_nonmatching_cs_resolved = {...PluginBase,commands:{Search:{}}};

return DuckDuckGo_280_0_nonmatching_cs_resolved;
 })()