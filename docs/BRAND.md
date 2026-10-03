# Brand kit

The Brand kit is the name, the logos, the colours, and a short list of things this brand never shows. It is in Settings, **Brand kit**. It is not a page in the top bar. You set it once and come back when something changes.

The mark and the colours are used when a Shot asks for them. **We never** is the exception: those words are held on every Shot, whether or not you attached the kit.

## Start from a website

On first launch, paste an address. Scenri reads the public page and drafts:

- a name, from the page title or the site name
- a logo, when it can find one it trusts
- colours, from the page

A logo it is not confident about is saved as an **Alternate**, not as the primary. A missing logo or a missing palette is a normal result. The kit says what it found.

This read does not invent Products. If the site is a store, Scenri can look for Products as a separate step. [Products](PRODUCTS.md) lists Shopify, WooCommerce, Webflow, and the generic reader.

Later, the same page has **Website** and **Refresh**. Refresh reads colours and marks again. Edits you already made are kept. New colours are offered, not applied.

## Logos

Drop a PNG, SVG, or JPG on the mark, or upload one. Each logo has a role:

- **Primary logo.** The one Scenri treats as the logo. There is one primary at a time. Promoting another demotes this one.
- **Mark, Wordmark, Monochrome, Alternate.** Other versions of the same brand. An Alternate is often the one a website read was not sure about, or a version for a dark or light ground.

In Create, **+** and the Brand tab place a mark chip. That chip is how a logo reaches a Shot. Scenri sends the stored file, full size, not a thumbnail. The model is told to draw it as given.

That is still a redraw. Scenri can promise the right file was sent. It cannot promise the letters come back pixel for pixel. A logo under 512 pixels on its long edge is kept, and Scenri warns you that fine lettering may not survive. Export a larger file, or an SVG.

On Replicate or fal, which carry no reference images, the Shot still runs. The composer says first that the mark will ride as words only.

Built-in Products, Presenters, and Scenes do not contain your logo. You attach it per Shot.

## Colours

**Palette** is the brand's colours. A Shot that asks for the kit favours them. In the line, `#` inserts one as a chip. You can also type a color that is not in the palette.

## We never

A short list of things the brand does not show. It applies even when you did not attach the kit. It does not override a direction you wrote. It only holds the boundary you already set.

## The file

**Export .brand** on this page downloads the kit as a zip. [Your files](FILES.md) says what is in it, and what stays on the computer.
