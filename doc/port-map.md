# Port Map
  
| Name  | From    | To | Port | Comments |
|------ | ------- | -- | ---- | -------- |
| Trigger build in ServiceNow |  ServiceNow |  CICD Reverse Proxy |  443 |  Via MID Server |
|                             |  CICD Reverse Proxy |  CICD Master |  8443 |   |
| Master > Node Job Queue |  CICD Master |  CICD Node |  4443 |  WebSocket |
|                         |  CICD Node |  CICD Master |  4443 |  WebSocket |
| MongoDB |  CICD Master |  MongoDB |  27017 |   |
|         |  CICD Node |  MongoDB |  27017 |   |
| Load data from ServiceNow |  CICD Master |  ServiceNow |  443 |  REST API calls on SNOW |
|                           |  CICD Node |  ServiceNow |  443 |  REST API calls on SNOW |
| Git operations (clone, push, etc) |  CICD Master |  Git Host |  443/22 |  Https or SSH clone |
|                                   |  CICD Node |  Git Host |  443/22 |  Https or SSH clone |
| Deploy Update Set |  ServiceNow |  ServiceNow |  443 |  Remote Instances across all environments |
| MID Server |  ServiceNow |  MID Server |  443 |  Standard setup |
| Git WebHooks |  Git Host |  CICD Reverse Proxy |  443 |  Pull Request Events (Merge, Comment, etc) |
| Build Events |  Build Tool |  Git Host |  443/22 |  Long polling for new merge to trigger build |
| Build |  Build Tool |  CICD Reverse Proxy |  443 |  E.g. trigger ATF execution in ServiceNow |
