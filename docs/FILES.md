# Your files

Scenri is local. It keeps your work on this computer. There is no Scenri account and no Scenri copy of your library.

## Where it lives

The folder is `.scenri` in your home folder.

- macOS and Linux: `~/.scenri`
- Windows: `%USERPROFILE%\.scenri`

Settings, **Library**, shows the path and can reveal it. That folder holds the database, your images, provider keys, and backups. Deleting it deletes the library. Export first if you might want it back.

`~/.scenri/app` is the installed copy of Scenri, not your work. Removing it is safe. The next `npx scenri` puts it back.

`~/.scenri/content` is the example library cache, not your Brands. Deleting it is safe. The next launch downloads it again.

The full statement of what is stored and what is sent is [Privacy](../PRIVACY.md).

## What stays here, and what a Shot sends

Your Brands, Shots, and keys stay in `.scenri`. Scenri does not upload them to itself.

When you generate, the prompt and its reference images go from this computer to the one provider you connected, and nowhere else. That includes Product photos, Presenter views, the Scene, and a logo chip. Say that plainly: the pictures do leave the machine, to your provider, for that Shot.

On its own, Scenri makes two optional requests: a version check against npm every six hours, and the download of the example library from GitHub. Both can be turned off. Privacy names the smaller cases, including a Product's first photo going to Codex once so a size can be read.

## Move a Brand

Settings, **Brand kit**, **Export .brand** downloads one Brand as a zip:

- `brand.json`
- an `assets/` folder of the images the kit references

The zip does not contain keys. It is safe to email. Another computer running Scenri can take that file as the kit.

The format, the schema, and the validator are Apache-2.0, so another tool may read and write them. The Scenri application is AGPL-3.0-only. Those are different licenses. The spec is [packages/brand-spec](../packages/brand-spec/SPEC.md).

**Export everything**, under Settings, **Library**, is the wider zip: Brands, cast, prompts, and Shots. It also excludes keys.

## A phone on the same network

Settings, **Local access**, shows an address and a six-digit code, as a QR code. A phone on the same Wi-Fi opens your computer's Scenri. It is still this library. The code is how a device that is not this computer is allowed in.

The first time, macOS or Windows may ask whether Node may accept incoming connections. Allow it, or the phone cannot connect. `SCENRI_HOST=127.0.0.1` keeps Scenri on this computer alone.
