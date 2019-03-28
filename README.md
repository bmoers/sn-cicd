
# CICD Server for Service-Now (V3)

This is the core CICD Server in version 3.\
For an implementation example, please have a look at https://github.com/bmoers/sn-cicd-example-v3.

## Table of contents

- [About](#about)
- [Whats New](#whats-new)
- [Features](#features)
- [Pull Requests](#pull-request)
- [Slack Example](#slack-example)
- [UI Example](#ui-example)
- [Process Flow](#process-flow)
    - [Invoke the CICD pipeline](#invoke_the_cicd_pipeline)
    - [Build project](#build_project)
    - [Pull request resolved](#pull_request_resolved)
    - [Trigger Build](#trigger_build)
    - [Trigger Tests](#trigger_tests)
    - [Trigger Deliver](#trigger_deliver)
    - [Trigger Deploy](#trigger_deploy)
    - [Trigger Deploy/Deliver via REST call](#trigger_deploy_deliver_via_rest_call)
- [Contribute](#contribute)
- [Release Notes](#release-notes-(3.0.0---3.1.0))
- [Dependencies](#project-dependencies)

## About
The aim of this project is to CICD-enable ServiceNow. Where CICD is used heavily in professional application development these days, there is no such thing in ServiceNow out-of-the-box. As the number of projects we implemented in ServiceNow grow, as more we struggled with doing thing right. It is just too dangerous to oversee an unwanted record in an update set or not having a clue if a change would do any harm on the platform.\
The difference between 'classic' software development and the way it works in ServiceNow is how changes are captured. In ServiceNow that's the job of an 'update set' or a 'scoped application' (see it as db row-dump in XML) - the others just use GIT for that.

So how difficult must it be to extract all code inside an 'update set' into a GIT repo and send it to a CICD pipeline?

Actually not very....

With this CICD-Server we mimic a local developer working in its IDE and committing code to a GIT repo and pushing it to origin. Every update set is represented as a branch on which then also the build process runs (build on branch, merge to master). If the build on branch is successful, the update set is deployed to the integration ServiceNow environment (e.g. test or integrated dev).
Have a look at the [Process Flow](#process-flow) for detailed information.

As the code is now in a GIT repo, standard tools like Bamboo or Jenkins etc can be used to trigger a longer pipeline with further stages to bring changes to production. 


## Whats New
#### Developers (End Users)
- Deploy update set from git repo
    - extract the code from the XML saved to git instead from the source environment
- Run CICD on scoped apps
    - automatically create an update set containing the complete scoped app and send it to the pipeline
- All changes are now exported to GIT
    - Fields containing JavaScript are still created as .js files
    - All other files / fields are exported as JSON
    - No 'empty pull request' anymore
-	The Update-Set, on which the CICD process runs, is also exported
-	Branches are automatically deleted on pull request merge
-	SSL support for portal
-	New Jobs Dashboard to display progress
-	More detailed 'build run' log


#### Platform
- Pull request proxy
    - route PR information from public git repo to CICD server
- REST API endpoints to integrate with standard build tools
    - trigger ATF test or deployment
- Use of scripted REST API to interact with ServiceNow 
    - [sn-cicd-integration (Global Scoped App)](https://github.com/bmoers/sn-cicd-integration)
-   Message-Queue driven Master/Worker architecture
    - Easy to scale up by adding additional workers (on local- or remote server)
-	ATF runs as worker job on server (and not anymore on build process/build tool)
-	Support for external build tool
    - Use CICD Server to extract code from ServiceNow and run a pipeline on e.g. Bamboo
    - Build results are automatically sent from build process (remote) to CICD server
-	Gulp tasks now configurable
    - Allow to modify and extend build stages
-	Better automated conflict detection on GIT merge
    -   Can be extended to inform about 'last commit wins' issues
-	Null value support for empty fields
    -	ServiceNow sometimes treats null as empty or empty as null, to avoid displaying unrelated changes in GIT empty is treated as null
-	Project DB (filesystem meta information) now in server and not in project
-	Option to extend or overwrite CICD server modules
-	Credentials only stored on CICD server (as env. variable) no Oauth token used anymore


## Features

Export, Build, Test and Deploy an Service-Now Update-Set.

On request (received from Service-Now) do:

- create a nodejs project
- init a git repo, link to remote repo, switch to master branch
- export all (related) files from Service-Now production instance
- switch to update-set branch
- export all files (sys_update_xml) from Service-Now development instance
- run `npm install`
- run `gulp`
  - document the files with JSDoc
  - check the quality with ESLint
  - run the test cases (ATF tests) IN Service-Now via mocha wrapper
- if all gulp tasks are successful
  - raise a pull request in remote git repo
  - wait for code review and pull request completion
  - on complete
    - set update-set `complete`
    - deploy update-set to target

## Pull Request

![pul request example][pull]

## Slack Example

![slack message example][slack]

## UI Example

![web ui example][web]


## Process Flow
### Invoke the CICD pipeline

| Steps | Dev | Prod (master) | Code | Comment |
| --- | --- | --- | --- | --- |
|   | Run CICD |   |   |   |
| Setup GIT repo on GIT host if required |   |   | lib\modules\run.js | Filter on commit message &#39;no-cicd&#39; to avoid the build to trigger. |
| Clone GIT |   |   |   |   |
|   |   | Extract files from prod into master branch (refresh in case changes made on prod without using this pipeline) | lib\modules\export-files-from-master.js |   |
| Push master to GIT |   |   |   | Filter on commit message &#39;no-cicd&#39; to avoid the build to trigger. |
| Create branch for update set if not already exists |   |   | lib\modules\export-update-set.js |   |
| Refresh update set branch with changes made on master. |   |   | To avoid merge collision later in the process. |
|   | Export update set XML |   |   |
|   | Export update set files |   |   |   |
| Configure Lint / JsDoc / ATF |   |   |   |   |
| Push branch to GIT |   |   |   | This will cause CICD pipeline to start if build on branch is enabled. |
| If CICD\_EMBEDDED\_BUILD is &#39;true&#39; |
| Build the branch locally |   |   | lib\modules\build-project.js |   |



### Build project

| Steps | Dev (Source) | Test (Target) | Code | Comment |
| --- | --- | --- | --- | --- |
| Gulp Init |   |   | lib\project-templates\gulpfile.js | Get build information from server (/build/config) |
| Gulp Lint, Doc |   |   | Lint and jsDoc results are zipped and sent to the CICD server (/build/task) |
| Gulp Test | Run ATF suites and tests |   | lib\project-templates\atf-wrapper.js | Start hidden browser as test runner on CICD server.Send zipped mocha results to CICD server (/build/task) |
| Gulp complete |   |   | lib\project-templates\gulpfile.js | Send build complete info to server (/build/complete). |
| Build complete |   |   | lib\modules\build-complete.js |   |
| If CICD\_GIT\_PR\_ENABLED is &#39;true&#39;. |
| Raise pull request |   |   |   | Raise PR in GIT system |
| Else If deploy target information in place and CD\_CD\_DEPLOY\_ON\_BUILD\_PASS is &#39;true&#39; |
|   |   | Complete update set |   | Update set can now be moved |
|   |   | Deploy to target | lib\modules\deploy-update-set.js | Deployment can be done either via update set pull from source or pull from GIT (CICD\_CD\_DEPLOY\_FROM\_GIT) |
| Else notify via Slack build has completed |

### Pull request resolved

| Steps | Dev (Source) | Test (Target) | Code | Comment |
| --- | --- | --- | --- | --- |
| Pull request completed |   |   | lib\cicd.js | PR information coming from GIT system (/pull\_request) |
| If pull request resolved |
| If CICD\_GIT\_DELETE\_BRANCH\_ON\_MERGE remove local branch | Delete branch locally and remote |
|   | Complete update set |   |   | Update set can now be moved |
| If CICD\_CD\_DEPLOY\_ON\_PR\_RESOLVE is &#39;true&#39; |
|   | Deploy to target |   | lib\modules\deploy-update-set.js | Deployment can be done either via update set pull from source or pull from GIT (CICD\_CD\_DEPLOY\_FROM\_GIT) |
|   |   |   |   |   |

### Trigger Build

Checkout code from GIT\
Run
- npm install
- gulp

This will test the application on the default host (source). If configured it will also raise a pull request against master branch.

### Trigger Tests

Checkout code from GIT\
Run
- npm install
- gulp test --commit-id &lt;commit-id&gt; --on-host &lt;test-host.service-now.com&gt;

--commit-id:         the commit ID of the build
--on-host: the         host on which the ATF test will run. If CICD\_ATF\_RUN\_ON\_PRODUCTION is &#39;false&#39; it will not allow to run on the master environment.

### Trigger Deliver

Checkout code from GIT\
Run
- npm install
- gulp deploy --commit-id &lt;commit-id&gt; --git --deliver-to &lt;target-host.service-now.com&gt; --deliver-from &lt;source-host. service-now.com&gt;

--commit-id:         the commit ID of the build

--git:        if exists, update set will be taken and deployed from GIT

--deliver-to:         the environment to deliver to

-- deliver-from:        the environment from which to deliver. If GIT is enabled, this environment will act as a proxy to connect to GIT.

###Trigger Deploy

Checkout code from GIT\
Run
- npm install
- gulp deploy --commit-id &lt;commit-id&gt; --git --deploy-to &lt;target-host.service-now.com&gt; --deploy-from &lt;source-host. service-now.com&gt;

--commit-id:         the commit ID of the build

--git:        if exists, update set will be taken and deployed from GIT

--deploy-to:         the environment to deploy to

--deploy-from:        the environment from which to deploy. If GIT is enabled, this environment will act as a proxy to connect to GIT.



### Trigger Deploy/Deliver via REST call

|  |   |
| --- | --- |
| Method |  POST |
| URL | /deploy/us |
| Header | "x-access-token": CICD_DEPLOY_ACCESS_TOKEN, "accept": "application/json" |
| Body | ```{"commitId": <the commit ID of the build>, "from": <source-host>, "to": <target-host>, "deploy": <true = deploy|false = deliver> [false],   "git": <true = via git|false = via source> [false] } ``` |

Rest client must support long polling and follow the redirects in the response header.




## Contribute

Please fork, please contribute.


<!-- 
https://www.npmjs.com/package/git-release-notes 
git-release-notes 3.1.0... markdown 
-->
## Release Notes (3.0.0 - 3.3.1) 

* __3.3.1 fix for delete files__

    [Boris Moers](mailto:boris@moers.ch) - Mon, 11 Feb 2019 13:35:43 +0100



* __fix for deletes not correctly tracked from update-set__

    [Boris Moers](mailto:boris@moers.ch) - Thu, 7 Feb 2019 17:23:59 +0100



* __3.2.2 - new release for PR #6__

    [Boris Moers](mailto:boris@moers.ch) - Tue, 15 Jan 2019 10:57:36 +0100



* __user for loading update-set form source should be CICD_CI_USER__

    [Brian Chen](mailto:gitlabalarm@gmail.com) - Tue, 15 Jan 2019 09:36:23 +1100



* __.env example__

    [Boris Moers](mailto:boris@moers.ch) - Thu, 10 Jan 2019 15:05:47 +0100



* __typos__

    [Boris Moers](mailto:boris@moers.ch) - Thu, 10 Jan 2019 15:03:44 +0100



* __3.2.1 - fix for CICD_SLACK_ENABLED toggle not working - console error in case of addStep error__

    [Boris Moers](mailto:boris@moers.ch) - Fri, 21 Dec 2018 14:38:27 +0100



* __3.2.0 - requires sn-cicd-integration ^1.2.3 - new CICD_EXPORT_SYS_FIELD_WHITELIST option to reduce th noise in PR - new CICD_GIT_BRANCH_LINK_TEMPLATE opt to controll link to rb in web-ui - new CICD_WEB_DIR option to have fully customized web UI - additionally fetch meta data from &#39;sys_scope&#39; - fix for CICD_EXPORT_NULL_FOR_EMPTY to not modify the payload by error - fix to get scope
from sys_update_xml record instead of sys_update_set - fix for non strings in getDisplayValue()__

    [Boris Moers](mailto:boris@moers.ch) - Fri, 21 Dec 2018 11:49:39 +0100



* __dont log args__

    [Boris Moers](mailto:boris@moers.ch) - Wed, 5 Dec 2018 21:10:21 +0100



* __less log noise on preview problems__

    [Boris Moers](mailto:boris@moers.ch) - Wed, 5 Dec 2018 20:46:56 +0100



* __3.1.4 - fix for teststep not always returning a promise__

    [Boris Moers](mailto:boris@moers.ch) - Tue, 4 Dec 2018 12:28:36 +0100



* __3.1.3 - in case only test-steps are captured in a US, find and exe its test__

    [Boris Moers](mailto:boris@moers.ch) - Fri, 30 Nov 2018 14:58:42 +0100



* __3.1.2 - set update-set status to CODE_REVIEW_PENDING on PR raised__

    [Boris Moers](mailto:boris@moers.ch) - Fri, 30 Nov 2018 13:49:56 +0100



* __3.1.1 - close update set on pr merge if no deployment requred__

    [Boris Moers](mailto:boris@moers.ch) - Fri, 30 Nov 2018 10:24:13 +0100



* __V3 readme__

    [Boris Moers](mailto:boris@moers.ch) - Thu, 29 Nov 2018 13:59:46 +0100


* __3.1.0 - export empty values as null   CICD_EXPORT_NULL_FOR_EMPTY - auto delete branch on merge   CICD_GIT_DELETE_BRANCH_ON_MERGE__

    [Boris Moers](mailto:boris@moers.ch) - Thu, 29 Nov 2018 06:26:06 +0100
    
    

* __worker node running status should change to pause when job done 	 - only the worker clientState need to be pause__

    [Brian Chen](mailto:gitlabalarm@gmail.com) - Wed, 28 Nov 2018 20:03:25 +1100
    
    

* __print version on start__

    [Boris Moers](mailto:boris@moers.ch) - Fri, 23 Nov 2018 16:02:10 +0100
    
    

* __sequence name in PR title__

    [Boris Moers](mailto:boris@moers.ch) - Fri, 23 Nov 2018 15:41:53 +0100
    
    

* __3.0.13 for consistency with integration us__

    [Boris Moers](mailto:boris@moers.ch) - Wed, 21 Nov 2018 15:50:34 +0100
    
    

* __3.0.12__

    [Boris Moers](mailto:boris@moers.ch) - Tue, 20 Nov 2018 11:00:12 +0100
    
    

* __issue with node 11.0.0 clearTimeout() consuming 100% cpu random statistics random pull__

    [Boris Moers](mailto:boris@moers.ch) - Tue, 20 Nov 2018 10:59:22 +0100
    
    

* __socket server options in case of timeout issues__

    [Boris Moers](mailto:boris@moers.ch) - Tue, 20 Nov 2018 10:52:58 +0100
    
    

* __3.0.11 - separated pm2 ecosystem files - standalone worker__

    [Boris Moers](mailto:boris@moers.ch) - Wed, 14 Nov 2018 10:12:23 +0100
    
    

* __3.0.10__

    [Boris Moers](mailto:boris@moers.ch) - Tue, 13 Nov 2018 16:31:14 +0100
    
    

* __fix for worker not connecting if server is down on start__

    [Boris Moers](mailto:boris@moers.ch) - Tue, 13 Nov 2018 16:30:45 +0100
    
    

* __3.0.9__

    [Boris Moers](mailto:boris@moers.ch) - Tue, 13 Nov 2018 15:04:39 +0100
    
    

* __format__

    [Boris Moers](mailto:boris@moers.ch) - Tue, 13 Nov 2018 15:04:06 +0100
    
    

* __dotenv only in cicd.js__

    [Boris Moers](mailto:boris@moers.ch) - Tue, 13 Nov 2018 15:03:35 +0100
    
    

* __make sure there is only one run object with lastCommitId__

    [Boris Moers](mailto:boris@moers.ch) - Tue, 13 Nov 2018 13:55:41 +0100
    
    

* __dedicated CD client__

    [Boris Moers](mailto:boris@moers.ch) - Tue, 13 Nov 2018 13:55:07 +0100
    
    

* __pass target credentials to deploy request__

    [Boris Moers](mailto:boris@moers.ch) - Tue, 13 Nov 2018 13:54:05 +0100
    
    

* __remove extra / in url__

    [Boris Moers](mailto:boris@moers.ch) - Tue, 13 Nov 2018 13:52:45 +0100
    
    

* __3.0.8__

    [Boris Moers](mailto:boris@moers.ch) - Thu, 8 Nov 2018 14:10:10 +0100
    
    

* __prefix option for servcie now api more control of deploy step__

    [Boris Moers](mailto:boris@moers.ch) - Thu, 8 Nov 2018 14:08:43 +0100
    
    

* __3.0.7__

    [Boris Moers](mailto:boris@moers.ch) - Wed, 7 Nov 2018 16:20:15 +0100
    
    

* __3.0.6__

    [Boris Moers](mailto:boris@moers.ch) - Wed, 7 Nov 2018 16:19:41 +0100
    
    

* __missing return on project setup__

    [Boris Moers](mailto:boris@moers.ch) - Wed, 7 Nov 2018 16:18:17 +0100
    
    

* __3.0.5 promise native delete pull request todo__

    [Boris Moers](mailto:boris@moers.ch) - Wed, 7 Nov 2018 15:44:41 +0100
    
    

* __3.0.4__

    [Boris Moers](mailto:boris@moers.ch) - Wed, 7 Nov 2018 15:19:28 +0100
    
    

* __check for PR changes on git server__

    [Boris Moers](mailto:boris@moers.ch) - Wed, 7 Nov 2018 15:18:58 +0100
    
    

* __align with new cicd.js structure__

    [Boris Moers](mailto:boris@moers.ch) - Wed, 7 Nov 2018 15:14:51 +0100
    
    

* __detailed step message for pull requrest abort__

    [Boris Moers](mailto:boris@moers.ch) - Wed, 7 Nov 2018 15:14:04 +0100
    
    

* __format code__

    [Boris Moers](mailto:boris@moers.ch) - Tue, 6 Nov 2018 10:55:28 +0100
    
    

* __in case of Commit Verification, GIT needs a valid user__

    [Boris Moers](mailto:boris@moers.ch) - Tue, 6 Nov 2018 10:35:59 +0100
    
    

* __project setup changes must be pushed__

    [Boris Moers](mailto:boris@moers.ch) - Tue, 6 Nov 2018 10:19:47 +0100
    
    

* __pm2 ecosystem file__

    [Boris Moers](mailto:boris@moers.ch) - Tue, 6 Nov 2018 10:19:09 +0100
    
    

* __3.0.3__

    [Boris Moers](mailto:boris@moers.ch) - Fri, 2 Nov 2018 14:32:16 +0100
    
    

* __support for pm2 cluster__

    [Boris Moers](mailto:boris@moers.ch) - Fri, 2 Nov 2018 14:31:45 +0100
    
    

* __3.0.2__

    [Boris Moers](mailto:boris@moers.ch) - Thu, 1 Nov 2018 08:30:15 +0100
    
    

* __use git from sn-project__

    [Boris Moers](mailto:boris@moers.ch) - Thu, 1 Nov 2018 08:30:01 +0100
    
    

* __use git from sn-project support for commitId from env var__

    [Boris Moers](mailto:boris@moers.ch) - Thu, 1 Nov 2018 08:29:51 +0100
    
    

* __chain test in sequence as parallel not supported by sno__

    [Boris Moers](mailto:boris@moers.ch) - Thu, 1 Nov 2018 08:28:25 +0100
    
    

* __cleanup__

    [Boris Moers](mailto:boris@moers.ch) - Thu, 1 Nov 2018 08:27:30 +0100
    
    

* __unique path issue git branch extensions__

    [Boris Moers](mailto:boris@moers.ch) - Thu, 1 Nov 2018 08:27:05 +0100
    
    

* __git branch extensions__

    [Boris Moers](mailto:boris@moers.ch) - Thu, 1 Nov 2018 08:25:19 +0100
    
    

* __remote datastore events__

    [Boris Moers](mailto:boris@moers.ch) - Thu, 1 Nov 2018 08:24:06 +0100
    
    

* __remote datastore support__

    [Boris Moers](mailto:boris@moers.ch) - Thu, 1 Nov 2018 08:22:48 +0100
    
    

* __moved to sn-project__

    [Boris Moers](mailto:boris@moers.ch) - Thu, 1 Nov 2018 08:20:43 +0100
    
    

* __event emitter optonal dir for db files remote datastore for project split file rest api call in chunks support for json extraction__

    [Boris Moers](mailto:boris@moers.ch) - Thu, 1 Nov 2018 08:20:24 +0100
    
    

* __also delete run with no directory assigned__

    [Boris Moers](mailto:boris@moers.ch) - Fri, 19 Oct 2018 12:22:04 +0200
    
    

* __remove test as will not work__

    [Boris Moers](mailto:boris@moers.ch) - Fri, 19 Oct 2018 12:21:05 +0200
    
    

* __event emitter__

    [Boris Moers](mailto:boris@moers.ch) - Fri, 19 Oct 2018 12:20:39 +0200
    
    

* __why is there a change?__

    [Boris Moers](mailto:boris@moers.ch) - Thu, 18 Oct 2018 17:38:39 +0200
    
    

* __project paht unique fix__

    [Boris Moers](mailto:boris@moers.ch) - Thu, 18 Oct 2018 17:38:16 +0200
    
    

* __error handling if git is not initalized__

    [Boris Moers](mailto:boris@moers.ch) - Thu, 18 Oct 2018 17:37:48 +0200
    
    

* __findOne__

    [Boris Moers](mailto:boris@moers.ch) - Thu, 18 Oct 2018 17:37:15 +0200
    
    

* __better error handling__

    [Boris Moers](mailto:boris@moers.ch) - Thu, 18 Oct 2018 17:36:42 +0200
    
    

* __distinguish between internal and external port check on start if server port is free refactore to  findOne__

    [Boris Moers](mailto:boris@moers.ch) - Thu, 18 Oct 2018 17:36:20 +0200
    
    

* __refactore to findOne__

    [Boris Moers](mailto:boris@moers.ch) - Thu, 18 Oct 2018 17:34:34 +0200
    
    

* __fix: directory structure was not unique housekeeping on worker nodes__

    [Boris Moers](mailto:boris@moers.ch) - Thu, 18 Oct 2018 17:33:18 +0200
    
    

* __housekeeping event to let worker do some file cleanup__

    [Boris Moers](mailto:boris@moers.ch) - Thu, 18 Oct 2018 17:32:06 +0200
    
    

* __introduce findeOne to simplify lookup__

    [Boris Moers](mailto:boris@moers.ch) - Thu, 18 Oct 2018 17:30:33 +0200
    
    

* __save pull request status__

    [Boris Moers](mailto:boris@moers.ch) - Thu, 18 Oct 2018 17:29:30 +0200
    
    

* __cluster events added__

    [Boris Moers](mailto:boris@moers.ch) - Wed, 17 Oct 2018 15:51:33 +0200
    
    

* __change logging__

    [Boris Moers](mailto:boris@moers.ch) - Wed, 17 Oct 2018 15:50:57 +0200
    
    




## Project dependencies

The project is designed to use extensions. This core project contains all 'shared' features. Customization which are dedicated to your Service-Now environment or CICD pipeline shall be added to the 'extending' project (like https://github.com/bmoers/sn-cicd-example-v3)

[pull]: https://github.com/bmoers/sn-cicd/raw/master/res/doc/pull-request.png "pull request"
[slack]: https://github.com/bmoers/sn-cicd/raw/master/res/doc/slack-messages.png "slack message example"
[web]: https://github.com/bmoers/sn-cicd/raw/master/res/doc/web.png "web ui example"
