<?php
/**
 * Seeds the fictional catalog from /data/catalog.json (idempotent by SKU).
 * Run: docker compose run --rm wpcli wp eval-file /cli/seed-products.php
 */

defined( 'ABSPATH' ) || exit;

$catalog = json_decode( file_get_contents( '/data/catalog.json' ), true );
if ( ! is_array( $catalog ) ) {
	WP_CLI::error( 'Cannot read /data/catalog.json' );
}

$created = 0;
foreach ( $catalog as $row ) {
	if ( wc_get_product_id_by_sku( $row['sku'] ) ) {
		continue;
	}
	$term = term_exists( $row['category'], 'product_cat' );
	if ( ! $term ) {
		$term = wp_insert_term( $row['category'], 'product_cat' );
	}
	$product = new WC_Product_Simple();
	$product->set_name( $row['name'] );
	$product->set_sku( $row['sku'] );
	$product->set_regular_price( (string) $row['price'] );
	$product->set_status( 'publish' );
	$product->set_category_ids( array( (int) $term['term_id'] ) );
	$product->save();
	$created++;
}

WP_CLI::success( "Products created: $created (catalog size " . count( $catalog ) . ')' );
