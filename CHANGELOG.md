# Changelog

## [0.1.1](https://github.com/MonsieurBarti/camoufox-pi/compare/camoufox-pi-v0.1.0...camoufox-pi-v0.1.1) (2026-04-12)


### Features

* **client:** add camoufoxclient lifecycle (ensureready, isalive, close) ([d1f231d](https://github.com/MonsieurBarti/camoufox-pi/commit/d1f231d502dcc198f62b106df048917b157c8ed5))
* **client:** add combinesignals helper ([84f03e8](https://github.com/MonsieurBarti/camoufox-pi/commit/84f03e8ddba74860919e3881bcfaebee7a165940))
* **client:** add launcher interface and launchedbrowser type ([8c29eb7](https://github.com/MonsieurBarti/camoufox-pi/commit/8c29eb775edfe713216f1b37b106afe3c570bbed))
* **client:** add navigate + fetchurl with signal + typed errors ([c7eb699](https://github.com/MonsieurBarti/camoufox-pi/commit/c7eb6996c44a53ecf81c1f154aa8e3a9b048ba99))
* **client:** add reallauncher backed by camoufox-js + playwright-core ([fb66f53](https://github.com/MonsieurBarti/camoufox-pi/commit/fb66f53471c28ccd33465c2066036049fcf87ead))
* **client:** add search method dispatching to duckduckgo adapter ([683828b](https://github.com/MonsieurBarti/camoufox-pi/commit/683828bc756b37a1479afc4454c5c5d0a7cb585b))
* **config:** populate camoufoxconfig with timeoutms + defaultengine ([16b219f](https://github.com/MonsieurBarti/camoufox-pi/commit/16b219f975126b03026371af1192f55ddc3f344c))
* **errors:** add camoufoxerror union, camoufoxerrorbox, mapplaywrighterror ([44a292e](https://github.com/MonsieurBarti/camoufox-pi/commit/44a292e4d7fc0d411da8af4fa734124e055b68b4))
* **extension:** thread abortsignal through tools; throw on invalid input ([7608aee](https://github.com/MonsieurBarti/camoufox-pi/commit/7608aeedb9f35af3766bc598cfccf7288fe795b8))
* **extension:** wire reallauncher and register tools on session_start ([d6af0f9](https://github.com/MonsieurBarti/camoufox-pi/commit/d6af0f943f8bb7f4fd7077db8d4cb7848bbcc1ff))
* foundational slice (camoufox-pi v0.1.0) ([3c278dc](https://github.com/MonsieurBarti/camoufox-pi/commit/3c278dc087b19ce6dfdbd4ea153e4f1a3899dceb))
* **search:** add duckduckgo html adapter with fixture test ([b1c5529](https://github.com/MonsieurBarti/camoufox-pi/commit/b1c552959a21f161508e41ca82e96bed7faa97d5))
* **search:** add searchengineadapter interface and rawresult ([f1b0b8c](https://github.com/MonsieurBarti/camoufox-pi/commit/f1b0b8c9b337388c80203cb70515060a2ec07821))
* **security:** harden fetch_url/search_web surface ([5ba738a](https://github.com/MonsieurBarti/camoufox-pi/commit/5ba738a0a1302af5ae877c92224115fe5e52a1bc))
* **service:** own camoufoxclient and kick off ensureready on init ([9d37de6](https://github.com/MonsieurBarti/camoufox-pi/commit/9d37de64414425ba37cf1bd30bec319a3611b654))
* **tools:** add tff-fetch_url tool wrapper ([9b1a2d1](https://github.com/MonsieurBarti/camoufox-pi/commit/9b1a2d1281f5534872b66bb31b3cc823f5e4c93b))
* **tools:** add tff-search_web tool wrapper ([eeb8d98](https://github.com/MonsieurBarti/camoufox-pi/commit/eeb8d98480df48d196b2d99838804261b16afa7d))


### Bug Fixes

* **client:** close during launching tears down freshly-launched browser ([744a54b](https://github.com/MonsieurBarti/camoufox-pi/commit/744a54b9a96e060f9224c118e7c6b4588c2fdc5d))
* **test-helpers:** remove launchfails leak into goto and track per-page url ([15c56d5](https://github.com/MonsieurBarti/camoufox-pi/commit/15c56d513702b0b8098a94ef03e926a9bde808b9))
* **test:** ddg stub handles comma selector; adapter test asserts snippet content ([8776a51](https://github.com/MonsieurBarti/camoufox-pi/commit/8776a5126018c44f430414d83e99a0673189ea1b))
* **tools:** register uri format so url validation fires ([0aaa972](https://github.com/MonsieurBarti/camoufox-pi/commit/0aaa9727fae19c1c3f96be4c544b485d66e1b5a8))
* wrap post-goto errors; validate client input; rename truncated; note signal gap ([40e3105](https://github.com/MonsieurBarti/camoufox-pi/commit/40e310508e227dfb7875102ceb2810ec230c33d8))

## Changelog
