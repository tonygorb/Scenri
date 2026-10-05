# Products

A Product is something the brand sells. You save it once, from its own photos or from a store, and every later Shot can attach it with `$`.

Scenri does not draw the Product into the picture by pasting the file. It sends the photos as reference images, and the model redraws them. Lettering can drift. The [FAQ](FAQ.md#is-the-product-in-the-picture-exact) says what is and is not guaranteed.

Nothing is generated while you add a Product, and nothing is spent.

## The library

**Products** in the top bar is the library. Scenri includes 30 Products you can shoot with immediately. The ones you add sit with them. **Keepers** on that page is the shortlist you marked.

**Add product** opens one dialog. Packshots and a store import are both in it.

## Add one from photos

1. Open **Products** and press **Add product**.
2. Add packshots: straight, well-lit photos of the thing itself. You can add up to 6.
3. Name it, and set a category if you want one. Both can wait.
4. Save.

A Shot attaches the first 3 of those photos. The rest stay on the Product for you. Open the Product later to change the name, category, material, or size.

If Codex is connected, Scenri can read a size from the first photo. You can change that size on the Product. A packshot fills its own frame, so the picture does not always say how big the object is.

## Import from a store

In the same dialog, give Scenri the store address.

Supported sources:

- **Shopify**
- **WooCommerce**
- **Webflow**
- **Any other site** Scenri can read as product pages. If it does not recognise a platform, it uses that generic reader. It does not claim support it did not detect.

You choose which Products to add. For each one Scenri keeps the name, the category when the page has one, and up to 3 pictures. Further image addresses stay recorded so you can fill a Product out later without crawling the store again.

A site that is not a store still has a Brand kit. That read is separate, and it does not invent Products. [Brand kit](BRAND.md).

## Use it

In Create, type `$` and choose the Product. The chip carries the photos. Write the direction in the same line. [Create a Shot](CREATE.md).
