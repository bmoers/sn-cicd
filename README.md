




Bamboo setup

CICD_GIT_PR_ENABLED=true
CICD_GIT_DELETE_BRANCH_ON_MERGE=true


CICD_EMBEDDED_BUILD=true

CICD_CD_DEPLOY_ON_PR_RESOLVE = false
CICD_CD_DEPLOY_ON_BUILD_PASS=false
CICD_CD_DEPLOY_FROM_GIT=true


issues
- user locke if target can not connect to source
- Using MID Server and getting No Sensors Defined




# CICD Server for Service-Now (V3)

This is the core CICD Server in version 3.\
For an implementation example, please have a look at https://github.com/bmoers/sn-cicd-example-v3.

## Table of contents

- [Whats New](#whats-new)
- [Features](#features)
- [Pull Requests](#pull-request)
- [Slack Example](#slack-example)
- [UI Example](#ui-example)
- [Contribute](#contribute)
- [Release Notes](#release-notes-(3.0.0---3.1.0))
- [Dependencies](#project-dependencies)

GULP
gulp test --on-host dev65672.service-now.com

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

# Process Flow
| Step | Dev | Test | Prod |
|------|-----|------|------|
|      | Run CICD > |      |      |
|      |     |      |      |
|      |     |      |      |

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
