<?php
/**
 * Creates the two signed Woo webhooks that feed n8n's real-time flow (idempotent by name).
 * The secret comes from the WOO_WEBHOOK_SECRET environment variable.
 * Run: docker compose run --rm -e WOO_WEBHOOK_SECRET wpcli wp eval-file /cli/create-webhooks.php
 */

defined( 'ABSPATH' ) || exit;

$secret = getenv( 'WOO_WEBHOOK_SECRET' );
if ( ! $secret ) {
	WP_CLI::error( 'WOO_WEBHOOK_SECRET is not set.' );
}

$url     = 'http://n8n:5678/webhook/woo-orders';
$admin   = get_user_by( 'login', getenv( 'WP_ADMIN_USER' ) ?: 'admin' );
$data    = WC_Data_Store::load( 'webhook' );
$created = 0;

foreach ( array( 'order.created', 'order.updated' ) as $topic ) {
	$name = "n8n → HubSpot ($topic)";
	$ids  = $data->search_webhooks( array( 'search' => $name, 'limit' => 1 ) );
	$hook = $ids ? wc_get_webhook( $ids[0] ) : new WC_Webhook();
	$hook->set_name( $name );
	$hook->set_topic( $topic );
	$hook->set_delivery_url( $url );
	$hook->set_secret( $secret );
	$hook->set_api_version( 'wp_api_v3' );
	$hook->set_user_id( $admin ? $admin->ID : 1 );
	$hook->set_status( 'active' );
	$hook->save();
	$created += $ids ? 0 : 1;
}

WP_CLI::success( "Webhooks created: $created (existing ones updated)" );
