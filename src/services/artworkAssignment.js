function error(message) {
  return { message, type: "artwork" };
}

/**
 * One order can contain either one bulk item or several individually printed items.
 * Artwork files are already sorted by their numeric filename prefix by orderParser.
 */
export function assignArtworks(order) {
  const files = order.artworks || [];
  const items = order.items || [];
  const errors = [...(order.errors || [])];

  if (!items.length) errors.push({ message: "No products were found in the packing slip.", type: "item" });
  if (!files.length) errors.push(error(`No artwork was found for ${order.shippingName}.`));

  if (items.length === 1) {
    // Bulk rule: one product line represents the whole quantity. Keep one
    // artwork in the API item; all detected files remain visible in the UI.
    items[0].artwork = files[0] || null;
    items[0].artworkCount = files.length;
    if (files.length > 1) items[0].quantity = files.length;
  } else if (files.length !== items.length) {
    errors.push(error(`${items.length} items but ${files.length} artworks were found. They cannot be assigned in order.`));
  } else {
    if (items.some((item) => Number(item.quantity) !== 1)) {
      errors.push(error("This order has multiple items, but at least one item has a quantity other than 1; one artwork per item cannot be assigned."));
    }
    items.forEach((item, index) => {
      item.artwork = files[index];
      item.artworkIndex = index + 1;
    });
  }

  order.errors = errors;
  order.valid = errors.length === 0;
  return order;
}
