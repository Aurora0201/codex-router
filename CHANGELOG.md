# Changelog

## [0.2.0](https://github.com/Aurora0201/codex-router/compare/v0.1.0...v0.2.0) (2026-08-12)


### Features

* add interactive account CLI command ([2249c56](https://github.com/Aurora0201/codex-router/commit/2249c5633c3e9b3ed46fbbade07f13b6294ff14b))
* add interactive account CLI command ([ff5e2e8](https://github.com/Aurora0201/codex-router/commit/ff5e2e8a887bfb700c51c93cdb1b49d3163ec698))
* add request and websocket evidence model ([3090ab0](https://github.com/Aurora0201/codex-router/commit/3090ab0bf5f6f9793762b676a7e324f0b7c188ab))
* improve runtime WebSocket observability ([4fd87c6](https://github.com/Aurora0201/codex-router/commit/4fd87c656974029999a15835ead2aafa301fe9c6))
* passthrough client identity when account pool is empty ([8f6d10e](https://github.com/Aurora0201/codex-router/commit/8f6d10e2d80cdeb976fa13a1747e277bd8116572))


### Bug Fixes

* handle Windows account login staging locks ([1fffc9f](https://github.com/Aurora0201/codex-router/commit/1fffc9f8799bd208f54273eaa93deedd326da9d5))
* preserve upstream transport error causes ([6997bcf](https://github.com/Aurora0201/codex-router/commit/6997bcffcd29572b412d8f2cb5b5678644e6d441))
* refine preferences page interactions ([2e38e73](https://github.com/Aurora0201/codex-router/commit/2e38e7335c6102b41f8dea695d16a4d3ed15ac19))
* refresh account quotas silently ([667e193](https://github.com/Aurora0201/codex-router/commit/667e193b779d67a12c5f20eb150e98d399b3d0b2))
* unify account login entry points ([bc41dd3](https://github.com/Aurora0201/codex-router/commit/bc41dd383ca3256f1d55538996a68881a161bf60))
* use static request log column widths ([58ffa38](https://github.com/Aurora0201/codex-router/commit/58ffa3822738dca2ae31634b57c40f9873ea4ca4))

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
