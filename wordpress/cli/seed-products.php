<?php
/**
 * Seeds a small fictional catalog (idempotent by SKU).
 * Run: docker compose run --rm wpcli wp eval-file /cli/seed-products.php
 */

defined( 'ABSPATH' ) || exit;

$catalog = array(
	array( 'DEMO-TEE-01', 'Organic Cotton Tee', 24.00, 'Apparel' ),
	array( 'DEMO-HOOD-01', 'Heavyweight Hoodie', 59.00, 'Apparel' ),
	array( 'DEMO-CAP-01', 'Six-Panel Cap', 19.00, 'Accessories' ),
	array( 'DEMO-BEAN-01', 'Merino Beanie', 29.00, 'Accessories' ),
	array( 'DEMO-MUG-01', 'Ceramic Mug 350 ml', 16.00, 'Home' ),
	array( 'DEMO-BOTL-01', 'Insulated Bottle 750 ml', 34.00, 'Home' ),
	array( 'DEMO-BAG-01', 'Canvas Tote Bag', 22.00, 'Accessories' ),
	array( 'DEMO-PACK-01', 'Everyday Backpack 20 L', 89.00, 'Bags' ),
	array( 'DEMO-JACK-01', 'Rain Shell Jacket', 149.00, 'Apparel' ),
	array( 'DEMO-SOCK-01', 'Wool Socks (3-pack)', 18.00, 'Apparel' ),
	array( 'DEMO-NOTE-01', 'Dot Grid Notebook A5', 14.00, 'Stationery' ),
	array( 'DEMO-PEN-01', 'Brass Pen', 39.00, 'Stationery' ),
	array( 'DEMO-LAMP-01', 'Desk Lamp', 79.00, 'Home' ),
	array( 'DEMO-CHAIR-01', 'Ergonomic Chair', 349.00, 'Office' ),
	array( 'DEMO-DESK-01', 'Standing Desk Frame', 499.00, 'Office' ),
);

$created = 0;
foreach ( $catalog as $row ) {
	list( $sku, $name, $price, $category ) = $row;
	if ( wc_get_product_id_by_sku( $sku ) ) {
		continue;
	}
	$term = term_exists( $category, 'product_cat' );
	if ( ! $term ) {
		$term = wp_insert_term( $category, 'product_cat' );
	}
	$product = new WC_Product_Simple();
	$product->set_name( $name );
	$product->set_sku( $sku );
	$product->set_regular_price( (string) $price );
	$product->set_status( 'publish' );
	$product->set_category_ids( array( (int) $term['term_id'] ) );
	$product->save();
	$created++;
}

WP_CLI::success( "Products created: $created (catalog size " . count( $catalog ) . ')' );
