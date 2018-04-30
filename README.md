# CICD Server for Service-Now

This is the core CICD Server.\
For an implementation example, please have a look at https://github.com/bmoers/sn-cicd-example.

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

If you want to contribute to this project, please fork the this project.

## Project dependencies

The project is designed to use extensions. This core project contains all 'shared' features. Customization which are dedicated to your Service-Now environment or CICD pipeline shall be added to the 'extending' project (like https://github.com/bmoers/sn-cicd-example)

[pull]: https://github.com/bmoers/sn-cicd/raw/master/res/doc/pull-request.png "pull request"
[slack]: https://github.com/bmoers/sn-cicd/raw/master/res/doc/slack-messages.png "slack message example"
[web]: https://github.com/bmoers/sn-cicd/raw/master/res/doc/web.png "web ui example"