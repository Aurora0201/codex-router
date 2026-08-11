# Changelog

## 0.1.0 (2026-08-11)


### Features

* add gateway restart command ([9b002d7](https://github.com/Aurora0201/codex-router/commit/9b002d7b0efb212accab9ca3effec0f5da98f32d))
* add interface language switching ([888f236](https://github.com/Aurora0201/codex-router/commit/888f2360060295cedb9d088895a96146ff184c4f))
* add mock-driven web-v2 frontend ([9e35ea9](https://github.com/Aurora0201/codex-router/commit/9e35ea9e6d66a7361c0e9269deebc102bf815661))
* add structured request log center ([393a594](https://github.com/Aurora0201/codex-router/commit/393a594eee1f1bdfd0d9a9ca177393e51d22e550))
* **cli:** add codex-router CLI with start/status/stop/logs/config ([db07e61](https://github.com/Aurora0201/codex-router/commit/db07e61a74033336950e50804df80445835494ef))
* **cli:** show active account quota and compact account rows in status ([4e84086](https://github.com/Aurora0201/codex-router/commit/4e84086684dffdf5c88b7ef7066ec907a5a67767))
* implement Codex Gateway MVP ([7e359d0](https://github.com/Aurora0201/codex-router/commit/7e359d0e8ad2848dc353b7d88e0228724907c018))
* improve request diagnostics and admin UI ([0585aea](https://github.com/Aurora0201/codex-router/commit/0585aea3b7443273cc432d95b7d388669bbb5303))
* refine request log workspace ([a1e4c78](https://github.com/Aurora0201/codex-router/commit/a1e4c78fc854d7f302222c786ec61d78c4e41efa))
* refine request log workspace ([7c9ca1f](https://github.com/Aurora0201/codex-router/commit/7c9ca1ff165e8835e3fd0bcd4ca8529ee1f3206f))
* retire websocket connections on account switch ([0ac20c7](https://github.com/Aurora0201/codex-router/commit/0ac20c77d07ccfa6b4f31b4c30bef13c8e26a73f))
* **server:** multi-account management, routing, and robust login ([318b044](https://github.com/Aurora0201/codex-router/commit/318b044600a4802b84ecadf0cf65be0fed9ac21a))
* **web-v2:** connect realtime gateway admin console ([d7485f0](https://github.com/Aurora0201/codex-router/commit/d7485f0db787d95ff8658419a7ee9bedb744a5a5))
* **web:** multi-account admin UI with shadcn components ([a40f804](https://github.com/Aurora0201/codex-router/commit/a40f8043982e7c9d244bcf77029403313595c8a9))
* **web:** promote web-v2 to default admin ui ([362cd36](https://github.com/Aurora0201/codex-router/commit/362cd367d7d47acc1b1dd832993918dd16f26fd3))


### Bug Fixes

* allow release without app credentials ([a73ae7e](https://github.com/Aurora0201/codex-router/commit/a73ae7e8e9acdea7b3aff1bae65fef10886056d5))
* allow release without app credentials ([1c2f950](https://github.com/Aurora0201/codex-router/commit/1c2f9500540800c587ae05523d7dbf498adf1b33))
* classify Codex compaction requests ([f145aa3](https://github.com/Aurora0201/codex-router/commit/f145aa35ab81fce5d353b9ae50d99c06053eb30b))
* classify downstream disconnects consistently ([b5dde0f](https://github.com/Aurora0201/codex-router/commit/b5dde0f5c81ee37593ff37921c6a546510f97c48))
* **cli:** detect entry script through npm-link symlink ([b5d9e44](https://github.com/Aurora0201/codex-router/commit/b5d9e4454c27e22fc2103458f4c0630126d35cc3))
* **cli:** read status accounts from the running gateway ([1f15d91](https://github.com/Aurora0201/codex-router/commit/1f15d91f7ec9361dcf9796e4c60625cfd06b6b01))
* **cli:** reject background start when the port is already in use ([ebac2ef](https://github.com/Aurora0201/codex-router/commit/ebac2ef4620f3a9b648d5eb9d5e0702c34b2f6cb))
* **proxy:** preserve query string when forwarding /models ([8812caa](https://github.com/Aurora0201/codex-router/commit/8812caa4364e4cfdeec3948c0e182cb248214ca3))
* **proxy:** proxy standalone web-search alpha/search route ([2328e00](https://github.com/Aurora0201/codex-router/commit/2328e00c5098b7788c0974e5bca77c9e1c895f91))
* refine local environment actions ([10cec6f](https://github.com/Aurora0201/codex-router/commit/10cec6f08918015bcd67c28853af0fcf55a99a21))
* refine request log pagination ([0543271](https://github.com/Aurora0201/codex-router/commit/05432711fbb5e3d84e05fce35504f7dcf2cf1e74))
* **ws:** raise client-side frame limit to 100MB ([64a06e4](https://github.com/Aurora0201/codex-router/commit/64a06e46ad5339b56ff5b3174f16518b249e9606))
