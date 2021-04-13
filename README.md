# CICD Server for Service-Now (V4)

This is the core CICD Server in version 4.\
For an implementation example, please have a look at https://github.com/bmoers/sn-cicd-example/tree/release/4.

## Table of contents

- [About](#about)
- [Whats New](#whats-new)
- [Features](#features)
- [Pull Requests](#pull-request)
- [Slack Example](#slack-example)
- [UI Example](#ui-example)
- [Process Flow](#process-flow)
  - [Invoke the CICD pipeline](#invoke-the-cicd-pipeline)
  - [Build project](#build-project)
  - [Pull request resolved](#pull-request-resolved)
  - [Trigger Build](#trigger-build)
  - [Trigger Tests](#trigger-tests)
  - [Trigger Deliver](#trigger-deliver)
  - [Trigger Deploy](#trigger-deploy)
  - [Trigger Deploy/Deliver via REST call](#trigger-deploydeliver-via-rest-call)
- [System Properties](#system-properties)
- [Contribute](#contribute)
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

### Developers (End Users)

- Deploy update set from git repo
  - extract the code from the XML saved to git instead from the source environment
- Run CICD on scoped apps
  - automatically create an update set containing the complete scoped app and send it to the pipeline
- All changes are now exported to GIT
  - Fields containing JavaScript are still created as .js files
  - All other files / fields are exported as JSON
  - No 'empty pull request' anymore
- The Update-Set, on which the CICD process runs, is also exported
- Branches are automatically deleted on pull request merge
- SSL support for portal
- New Jobs Dashboard to display progress
- More detailed 'build run' log

### Platform

- Pull request proxy
  - route PR information from public git repo to CICD server
- REST API endpoints to integrate with standard build tools
  - trigger ATF test or deployment
- Use of scripted REST API to interact with ServiceNow 
  - [sn-cicd-integration (Global Scoped App)](https://github.com/bmoers/sn-cicd-integration)
- Message-Queue driven Master/Worker architecture
  - Easy to scale up by adding additional workers (on local- or remote server)
- ATF runs as worker job on server (and not anymore on build process/build tool)
- Support for external build tool
  - Use CICD Server to extract code from ServiceNow and run a pipeline on e.g. Bamboo
  - Build results are automatically sent from build process (remote) to CICD server
- Gulp tasks now configurable
  - Allow to modify and extend build stages
- Better automated conflict detection on GIT merge
  - Can be extended to inform about 'last commit wins' issues
- Null value support for empty fields
  - ServiceNow sometimes treats null as empty or empty as null, to avoid displaying unrelated changes in GIT empty is treated as null
- Project DB (filesystem meta information) now in server and not in project
- Option to extend or overwrite CICD server modules
- Credentials only stored on CICD server (as env. variable) no Oauth token used anymore

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

### Trigger Deploy

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
| Body | ```{"commitId": <the commit ID of the build>, "from": <source-host>, "to": <target-host>, "deploy": <true = deploy\| false = deliver> [false],   "git": <true = via git \| false = via source> [false] }```  |

Rest client must support long polling and follow the redirects in the response header.

## System Properties

Git clone might run long on large GIT repos and deployments time out. To avoid consider following settings:

- glide.http.outbound.max_timeout.enabled=false
- glide.rest.outbound.ecc_response.timeout=300

More information about REST calls via MID server can be found here [KB0694711](https://support.servicenow.com/kb?id=kb_article_view&sysparm_article=KB0694711)

## Contribute

Please fork, please contribute.


<!-- 
https://www.npmjs.com/package/git-release-notes 
git-release-notes 3.1.0... markdown 
-->

## Project dependencies

The project is designed to use extensions. This core project contains all 'shared' features. Customization which are dedicated to your Service-Now environment or CICD pipeline shall be added to the 'extending' project (like https://github.com/bmoers/sn-cicd-example-v3)

[pull]: https://github.com/bmoers/sn-cicd/raw/master/res/doc/pull-request.png "pull request"
[slack]: https://github.com/bmoers/sn-cicd/raw/master/res/doc/slack-messages.png "slack message example"
[web]: https://github.com/bmoers/sn-cicd/raw/master/res/doc/web.png "web ui example"
