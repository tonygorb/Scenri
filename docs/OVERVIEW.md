# Overview

Scenri is a local photo studio for a brand. It runs on your computer, opens in your browser, and keeps the brand's work on your disk.

A Brand holds four things you reuse:

- **Products**, what the brand sells.
- **Presenters**, who appears in the pictures.
- **Scenes**, where and how a picture is lit and staged.
- **Shots**, the pictures you make from those, one card each.

Create is where a Shot is made. The line takes a Product with `$`, a Presenter with `@`, a Scene with `/`, and a colour with `#`. The words between those chips are the direction.

The library already includes 30 Products, 19 Presenters, 42 Scenes, and 110 example Shots, so you can make a picture before you have added anything of your own.

Scenri does not include image generation. You connect Codex on a paid ChatGPT plan, or a key from OpenRouter, Replicate, or fal. When you generate, the prompt and its reference images go to that provider.

Your Brands, Shots, and keys live in a folder named `.scenri` in your home folder.

## Where to go

- [Install Scenri](INSTALL.md) if you do not have it yet.
- [Quick start](QUICKSTART.md) for the shortest path to one Shot.
- [Concepts](CONCEPTS.md) for the words the app uses.
- [Connect image generation](CONNECT.md) before the first picture.
- [Troubleshooting](TROUBLESHOOTING.md) when a start or a Shot fails.

To work on Scenri itself, start with [CONTRIBUTING.md](../CONTRIBUTING.md).
