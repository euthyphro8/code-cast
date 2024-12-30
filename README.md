# Code Cast

An application that can be used to cast (listen) for github webhooks in order to build and update a SPA.

## Motivation

This application is originally designed for the usecase of hosting several applications on a single server in active(ish) developement. The server being used reverse proxies to each of the applications, most of which are SPAs. Thus the application need only build and copy the static files to the location being served by nginx. However, it's designed to be flexible enough to run any cli command needed to build said application and then copy the output wherever it's needed.

## Usage

To use this app you should you simply need it running on the target server, setup a webhook on the repo to target application and finally to configure the Code Cast application to listen for the given repo.

Obviously the Code Cast application must have appropriate permissions to build and copy the files needed for said process.

## Config

The application will look for the config file at the environment variable `CC_CONFIG_DIR`. The config file looks something like the following.

```json
{
  "reposDirectory": "/repos", // The staging directory to pull and build files.
  "serveDirectory": "/srv", // The root path to copy bauild files to
  "listeners": [
    // The array of listener rules, can handle a generic amount.
    {
      "filters": {
        "username": "euthyphro8" // Verfies the commit is from the given username, email, or name.
      },
      "repository": "repo-name", // The name of the repository, this is so you can listen to an arbitrary amount of webhooks
      "branch": "master", // Optional: only runs if the commit is found on the given branch
      "commitFlag": "[deploy]", // Optional: only runs if this string is found in the commit message
      "dist": {
        "in": "dist", // The folder the app will look for build files
        "out": "app-output-dir" // Will copy contents of `in` here
      },
      "strategy": {
        "type": "custom", // Or default to simply run `npm run build`.
        "script": "npm run build" // This will get ran in a child process, can be any cli
      }
    }
  ]
}
```

Note that each repo is required to already exist and are expected to be at `${reposDirectory}/${repository-name}`.

## License

Licensed under [MIT](./LICENSE).
