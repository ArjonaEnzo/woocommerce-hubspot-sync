<?php
/**
 * Loads /data/orders.json into WooCommerce with the CRUD API (works with HPOS).
 * Backdates orders (the REST API cannot), creates refunds, and is re-runnable:
 * an order whose _demo_gen_id already exists is skipped.
 *
 * Run: docker compose run --rm wpcli wp eval-file /cli/load-orders.php
 */

defined( 'ABSPATH' ) || exit;

add_filter( 'pre_wp_mail', '__return_false' ); // never send mail from the demo store

$orders = json_decode( file_get_contents( '/data/orders.json' ), true );
if ( ! is_array( $orders ) ) {
	WP_CLI::error( 'Cannot read /data/orders.json — run: node scripts/generate-orders.mjs' );
}

$created = 0;
$skipped = 0;

foreach ( $orders as $row ) {
	$existing = wc_get_orders(
		array(
			'limit'      => 1,
			'return'     => 'ids',
			'meta_key'   => '_demo_gen_id', // phpcs:ignore WordPress.DB.SlowDBQuery
			'meta_value' => $row['gen_id'], // phpcs:ignore WordPress.DB.SlowDBQuery
		)
	);
	if ( $existing ) {
		$skipped++;
		continue;
	}

	$c           = $row['customer'];
	$customer_id = 0;
	if ( ! empty( $c['registered'] ) ) {
		$user        = get_user_by( 'email', $c['email'] );
		$customer_id = $user ? $user->ID : wc_create_new_customer( $c['email'], '', wp_generate_password(), array( 'first_name' => $c['first_name'], 'last_name' => $c['last_name'] ) );
		if ( is_wp_error( $customer_id ) ) {
			$customer_id = 0;
		}
	}

	$order = wc_create_order( array( 'customer_id' => $customer_id ) );
	foreach ( $row['items'] as $item ) {
		$order->add_product( wc_get_product( wc_get_product_id_by_sku( $item['sku'] ) ), (int) $item['quantity'] );
	}
	$order->set_address(
		array(
			'first_name' => $c['first_name'],
			'last_name'  => $c['last_name'],
			'company'    => $c['company'],
			'email'      => $c['email'],
			'phone'      => $c['phone'],
			'country'    => $c['country'],
		),
		'billing'
	);
	$order->set_currency( 'USD' );
	$order->set_date_created( strtotime( $row['date_created'] ) );
	$order->update_meta_data( '_demo_gen_id', $row['gen_id'] );
	$order->calculate_totals( false );
	// A fully refunded order is created as completed; the full refund then moves it to "refunded".
	$order->set_status( 'refunded' === $row['status'] ? 'completed' : $row['status'] );
	$order->save();

	if ( $row['refund_amount'] > 0 ) {
		$refund = wc_create_refund(
			array(
				'order_id' => $order->get_id(),
				'amount'   => $row['refund_amount'],
				'reason'   => 'refunded' === $row['status'] ? 'Order returned' : 'Partial refund: damaged item',
			)
		);
		if ( is_wp_error( $refund ) ) {
			WP_CLI::warning( "Refund failed for {$row['gen_id']}: " . $refund->get_error_message() );
		}
	}
	$created++;
}

WP_CLI::success( "Orders created: $created, skipped (already loaded): $skipped" );
