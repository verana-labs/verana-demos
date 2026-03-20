# Verana Demos reorg

We want to reorganize verana demos:

## Issuer Service

### Issuer Service Vs-Agent (already existing)

this is what currently exists

### Issuer Service  Chatbot Service (not yet existing)

Interact with the Issuer Service Vs-Agent, and provide the following features:

- requires enabling anoncreds on the issuer (enable it by default in the config.env of the issuer)
- uses the custom schema of the issuer. Chatbot must have a config option to target a customized vs of the user.
- it must be possible to execute the bot locally, and a container must be built to be able to fully deply a customized chatbot.

User experience:

- user connects to the chatbot
- chatbot send welcome message to user
- then chatbot prompt user for all attributes of the credential schema (one by one)
- when it has all the attributes, it issues a credential to user with these attributes.
 and request each attribute to the user
- a contextual menu exist and show title $SERVICE_NAME Issuer. In menu entries, shows "abort" (user is currently in the flow of providing the attributes) or "new credential" (previous flow is terminated)

 Note:
- connectionIds must be persisted in a database so that if service is restarted, it still work.

## Web Verifier Service (not yet existing)

A mini configurable website that can be executed locally or deployed in kubernetes (a container must be generated). It must be possible to configure the schema that is targeted. Service must embed a VS-Agent too.

It shows a mini website requesting the presentation of the credentil showing an OOB presentation request (QR code). User scans, present credential obtained with the issuer, and data is shown on screen. A "start over" button send the user back to the OOB presentation request (QR code) for testing another credential.


## Chatbot Verifier Service (not yet existing)

A mini configurable chatbot that can be executed locally or deployed in kubernetes (a container must be generated). It must be possible to configure the schema that is targeted. Service must embed a VS-Agent too.

- user connects to the chatbot
- chatbot send welcome message to user
- chatbot request the presentation of a credential previously issued by the issuer service
- user presents the credential and chatbot answer with a text that welcome the user and contains all attributes of the credentials.
- a contextual menu exist and show title $SERVICE_NAME Verifier. In menu entries, shows "abort" (user is currently in the flow of prsenting the credential) or "new presentation" (previous flow is terminated) to trigger the presentation request of a new credential

## General Chatbot comments

- Remember the contextual menu must be resent each time a message is sent to user.
- User will need Hologram Messaging to consume the chatbots / store the credential

## Local Execution

- user must be able to execute all services in its local environment

## Github Action Deployment

- user must be able to trigger a workflow for each service
