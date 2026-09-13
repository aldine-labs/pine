# @pine/rpiv-ask-user-question

Pine's host-neutral adapter for the `ask_user_question` protocol. Its schema,
validation rules, and result envelope are adapted from
[`@juicesharp/rpiv-ask-user-question`](https://github.com/juicesharp/rpiv-mono/tree/main/packages/rpiv-ask-user-question),
used under the MIT license in `LICENSE.upstream`.

The upstream package owns a Pi terminal UI. Pine keeps the protocol in this
workspace package and supplies its own Electron/Vue host bridge and UI.
