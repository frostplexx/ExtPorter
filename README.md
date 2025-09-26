# ExtPorter



# TODO 

- [ ] Improve the comparison between mv2 and mv3
- [X] dotenv should only be called once and not load for every extension
- [ ] Make sure it actually tests the mv2 and mv3 versions
    - [ ] add some checks for that in code too
    - [ ] make sure the mv3 extension actually hasthe new paths set after the migration
- [X] Dockerise everything
- [ ] Write a script that generates some fun statistics from the mongodb
- [ ] Make it use multiple cores?
- [X] Better normalize all the logs e.g. everything should have the extension id
- [ ] Improve logging for mv2 new tab test
- [X] Sort out new-tab wallpapers in output
- [X] Add tooling for quickly loading extensions as both mv2 and mv3
- [X] Return error instead of null in the migrate() function
- [X] Add downloading of remote resources
- [ ] Preprocessing of manifest.json files so invalid characters and stuff get removed
- [ ] Handle multiple background scripts
- [ ] test if remote resources get downloaded correctly
- [ ] Handle optional permissions
- [ ] compare the DOM
- [ ]   The migrator only transforms:
  - chrome.tabs.executeScript → chrome.scripting.executeScript

  But it ignores:
  - Parameter count change (2 params → 1 param)
  - Parameter structure change (separate tabId and details → combined injection object)

  Key Limitations

  1. No parameter analysis: The nodeMatchesSourcePattern() method at /Users/daniel/Developer/github.com/frostplexx/Bachelor_Thesis/research/migrator/src/modules/api_renames.ts:237 only checks API paths, not parameter structure
  2. No argument transformation: The applyTargetTransformation() method at line 265 only updates member expressions, not function arguments
  3. Unused formal definitions: The formals arrays in the mapping JSON are loaded but never used in the transformation logic

  Result

  Code like:
  chrome.tabs.executeScript(tabId, { code: "..." });

  Becomes:
  chrome.scripting.executeScript(tabId, { code: "..." }); // Still broken!

  Instead of the correct MV3 format:
  chrome.scripting.executeScript({
    target: { tabId: tabId },
    code: "..."
  });

  The migrator handles API namespace changes but doesn't address the more complex parameter restructuring needed for full MV2→MV3 migration.

# FIXME

- [ ] Some popup tests fail
- [ ] Icons for extensions dont work anymore?
- [X] On the processing JS error add what the actual error is
- [ ] Some content secuity policies are broken/invalid after migrating
- [ ] Some new-tab tests seem to fail randomly
- [x] puppeteer sometimes crashes
- [ ] sometimes the popup doesnt get copied? e.g. with ./output/oiibaihkmlkilofifhdfjlmbkaolchgp/
```fish
[ERROR] Popup test failed for Nano Adblocker: {
  error: 'net::ERR_BLOCKED_BY_CLIENT at chrome-extension://aplpkchgkfgpogbhajolpfnekodkpndn/popup.html'
}
[INFO] Extension tests completed for: Nano Adblocker { success: false, testsRun: 1, duration: 111.44066699998803 }
/Users/daniel/Developer/github.com/frostplexx/Bachelor_Thesis/research/migrator/node_modules/puppeteer-core/src/common/CallbackRegistry.ts:101
      this._reject(callback, new TargetCloseError('Target closed'));
                             ^
TargetCloseError: Protocol error (Extensions.loadUnpacked): Target closed
    at CallbackRegistry.clear (/Users/daniel/Developer/github.com/frostplexx/Bachelor_Thesis/research/migrator/node_modules/puppeteer-core/src/common/CallbackRegistry.ts
:101:30)
    at Connection.#onClose (/Users/daniel/Developer/github.com/frostplexx/Bachelor_Thesis/research/migrator/node_modules/puppeteer-core/src/cdp/Connection.ts:224:21)
    at Socket.<anonymous> (/Users/daniel/Developer/github.com/frostplexx/Bachelor_Thesis/research/migrator/node_modules/puppeteer-core/src/node/PipeTransport.ts:42:22)
    at Socket.emit (node:events:530:35)
    at Socket.emit (node:domain:489:12)
    at Pipe.<anonymous> (node:net:346:12) {
  cause: ProtocolError
      at Callback.<instance_members_initializer> (/Users/daniel/Developer/github.com/frostplexx/Bachelor_Thesis/research/migrator/node_modules/puppeteer-core/src/common/
CallbackRegistry.ts:127:12)
      at new Callback (/Users/daniel/Developer/github.com/frostplexx/Bachelor_Thesis/research/migrator/node_modules/puppeteer-core/src/common/CallbackRegistry.ts:132:3)
      at CallbackRegistry.create (/Users/daniel/Developer/github.com/frostplexx/Bachelor_Thesis/research/migrator/node_modules/puppeteer-core/src/common/CallbackRegistry
.ts:30:22)
      at Connection._rawSend (/Users/daniel/Developer/github.com/frostplexx/Bachelor_Thesis/research/migrator/node_modules/puppeteer-core/src/cdp/Connection.ts:136:22)
      at Connection.send (/Users/daniel/Developer/github.com/frostplexx/Bachelor_Thesis/research/migrator/node_modules/puppeteer-core/src/cdp/Connection.ts:120:17)
      at CdpBrowser.installExtension (/Users/daniel/Developer/github.com/frostplexx/Bachelor_Thesis/research/migrator/node_modules/puppeteer-core/src/cdp/Browser.ts:369:
41)
      at /Users/daniel/Developer/github.com/frostplexx/Bachelor_Thesis/research/migrator/node_modules/puppeteer-core/src/node/BrowserLauncher.ts:228:26
      at Array.map (<anonymous>)
      at ChromeLauncher.launch (/Users/daniel/Developer/github.com/frostplexx/Bachelor_Thesis/research/migrator/node_modules/puppeteer-core/src/node/BrowserLauncher.ts:2
27:26)
      at runNextTicks (node:internal/process/task_queues:65:5)
}
```
error Command failed with exit code 1.
- [ ] Sometimes it fails to load extensions
- [ ] I think the extension id in the mv3 test results is still the mv2 one
- [ ] The folder name of the mv3 extensions is still the mv2 id
- [ ] fix:"error": "ENOENT: no such file or directory, open '/Users/daniel/Developer/github.com/frostplexx/Bachelor_Thesis/research/dataset/abenoopklclfmphonmfbmamkcfpbenin/_metadata/verified_contents.json'"
- [ ] ./output/ponpakfnkmdgcabfiebpbppmheghigmh/: 
^[[O/Users/daniel/Developer/github.com/frostplexx/Bachelor_Thesis/research/migrator/node_modules/puppeteer-core/src/common/CallbackRegistry.ts:127
  #error = new ProtocolError();
           ^
ProtocolError: Protocol error (Extensions.loadUnpacked): Could not load javascript 'pusher.min.js' for script.
    at Callback.<instance_members_initializer> (/Users/daniel/Developer/github.com/frostplexx/Bachelor_Thesis/research/migrator/node_modules/puppeteer-core/src/common/CallbackRegistry.ts:127:12)
    at new Callback (/Users/daniel/Developer/github.com/frostplexx/Bachelor_Thesis/research/migrator/node_modules/puppeteer-core/src/common/CallbackRegistry.ts:132:3)
    at CallbackRegistry.create (/Users/daniel/Developer/github.com/frostplexx/Bachelor_Thesis/research/migrator/node_modules/puppeteer-core/src/common/CallbackRegistry.ts:30:22)
    at Connection._rawSend (/Users/daniel/Developer/github.com/frostplexx/Bachelor_Thesis/research/migrator/node_modules/puppeteer-core/src/cdp/Connection.ts:136:22)
    at Connection.send (/Users/daniel/Developer/github.com/frostplexx/Bachelor_Thesis/research/migrator/node_modules/puppeteer-core/src/cdp/Connection.ts:120:17)
    at CdpBrowser.installExtension (/Users/daniel/Developer/github.com/frostplexx/Bachelor_Thesis/research/migrator/node_modules/puppeteer-core/src/cdp/Browser.ts:369:41)
    at /Users/daniel/Developer/github.com/frostplexx/Bachelor_Thesis/research/migrator/node_modules/puppeteer-core/src/node/BrowserLauncher.ts:228:26
    at Array.map (<anonymous>)
    at ChromeLauncher.launch (/Users/daniel/Developer/github.com/frostplexx/Bachelor_Thesis/research/migrator/node_modules/puppeteer-core/src/node/BrowserLauncher.ts:227:26)
    at runNextTicks (node:internal/process/task_queues:65:5)
error Command failed with exit code 1.
info Visit https://yarnpkg.com/en/docs/cli/run for documentation about this command.
- [ ] fix content security policies
- [ ] some files dont seem to copied correctly
- [ ] Extensions can open new browser windows that ignore the headless directive and wont close automatically -> handle
- [ ] FIX:
<--- Last few GCs --->

[31835:0x148008000]  1414304 ms: Mark-Compact 4036.1 (4131.5) -> 4018.3 (4129.8) MB, pooled: 0 MB, 652.04 / 0.00 ms  (average mu = 0.165, current mu = 0.028) allocation failure; scavenge might not succeed
[31835:0x148008000]  1414974 ms: Mark-Compact 4041.7 (4138.9) -> 3996.9 (4108.2) MB, pooled: 24 MB, 650.79 / 0.00 ms  (average mu = 0.109, current mu = 0.029) task; scavenge might not succeed


<--- JS stacktrace --->

FATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed - JavaScript heap out of memory
----- Native stack trace -----

 1: 0x1003c1118 node::OOMErrorHandler(char const*, v8::OOMDetails const&) [/nix/store/9yqq8szyz3qx8q6xlv1s3arhw4112wc8-nodejs-22.18.0/bin/node]
 2: 0x1005baa88 v8::internal::V8::FatalProcessOutOfMemory(v8::internal::Isolate*, char const*, v8::OOMDetails const&) [/nix/store/9yqq8szyz3qx8q6xlv1s3arhw4112wc8-nodejs-22.18.0/bin/node]
 3: 0x100808d1c v8::internal::Heap::stack() [/nix/store/9yqq8szyz3qx8q6xlv1s3arhw4112wc8-nodejs-22.18.0/bin/node]
 4: 0x1008210e0 v8::internal::Heap::CollectGarbage(v8::internal::AllocationSpace, v8::internal::GarbageCollectionReason, v8::GCCallbackFlags)::$_1::operator()() const [/nix/store/9yqq8szyz3qx8q6xlv1s3arhw4112wc8-nodejs-22.18.0/bin/node]
 5: 0x100820940 void heap::base::Stack::SetMarkerAndCallbackImpl<v8::internal::Heap::CollectGarbage(v8::internal::AllocationSpace, v8::internal::GarbageCollectionReason, v8::GCCallbackFlags)::$_1>(heap::base::Stack*, void*, void const*) [/nix/store/9yqq8szyz3qx8q6xlv1s3arhw4112wc8-nodejs-22.18.0/bin/node]
 6: 0x10108a730 PushAllRegistersAndIterateStack [/nix/store/9yqq8szyz3qx8q6xlv1s3arhw4112wc8-nodejs-22.18.0/bin/node]
 7: 0x1008069d0 v8::internal::Heap::CollectGarbage(v8::internal::AllocationSpace, v8::internal::GarbageCollectionReason, v8::GCCallbackFlags) [/nix/store/9yqq8szyz3qx8q6xlv1s3arhw4112wc8-nodejs-22.18.0/bin/node]
 8: 0x10086254c v8::internal::MinorGCJob::Task::RunInternal() [/nix/store/9yqq8szyz3qx8q6xlv1s3arhw4112wc8-nodejs-22.18.0/bin/node]
 9: 0x100449c58 node::PerIsolatePlatformData::RunForegroundTask(std::__1::unique_ptr<v8::Task, std::__1::default_delete<v8::Task>>) [/nix/store/9yqq8szyz3qx8q6xlv1s3arhw4112wc8-nodejs-22.18.0/bin/node]
10: 0x100448820 node::PerIsolatePlatformData::FlushForegroundTasksInternal() [/nix/store/9yqq8szyz3qx8q6xlv1s3arhw4112wc8-nodejs-22.18.0/bin/node]
11: 0x103e35188 uv__async_io [/nix/store/7jx6z5yfx9byiafsgzzsnm88wj2r4qgd-libuv-1.51.0/lib/libuv.1.dylib]
12: 0x103e4ad30 uv__io_poll [/nix/store/7jx6z5yfx9byiafsgzzsnm88wj2r4qgd-libuv-1.51.0/lib/libuv.1.dylib]
13: 0x103e358ec uv_run [/nix/store/7jx6z5yfx9byiafsgzzsnm88wj2r4qgd-libuv-1.51.0/lib/libuv.1.dylib]
14: 0x1002c406c node::SpinEventLoopInternal(node::Environment*) [/nix/store/9yqq8szyz3qx8q6xlv1s3arhw4112wc8-nodejs-22.18.0/bin/node]
15: 0x1004146e4 node::NodeMainInstance::Run() [/nix/store/9yqq8szyz3qx8q6xlv1s3arhw4112wc8-nodejs-22.18.0/bin/node]
16: 0x100376444 node::Start(int, char**) [/nix/store/9yqq8szyz3qx8q6xlv1s3arhw4112wc8-nodejs-22.18.0/bin/node]
17: 0x18b665d54 start [/usr/lib/dyld]
/bin/sh: line 1: 31835 Abort trap: 6           ts-node src/index.ts ../dataset/ ./output/



# Docker

**Build and start all services**
docker-compose up --build

**Run in detached mode**
docker-compose up -d

**View logs**
docker-compose logs migrator-app

**Stop services**
docker-compose down
