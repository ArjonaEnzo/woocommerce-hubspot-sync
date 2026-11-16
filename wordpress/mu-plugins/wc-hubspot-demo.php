<?php
/**
 * Plugin Name: WooCommerce → HubSpot demo helpers
 * Description: Local-only tweaks so Woo webhooks can reach n8n on the Docker network.
 */

defined( 'ABSPATH' ) || exit;

// Woo delivers webhooks with wp_safe_remote_request(), which refuses private hosts.
// Allow only the n8n container's hostname.
add_filter(
	'http_request_host_is_external',
	static function ( $is_external, $host ) {
		return $is_external || 'n8n' === $host;
	},
	10,
	2
);

// wp_safe_remote_request() also only allows ports 80, 443 and 8080; n8n listens on 5678.
add_filter(
	'http_allowed_safe_ports',
	static function ( $ports ) {
		$ports[] = 5678;
		return $ports;
	}
);

// Deliver webhooks immediately instead of via Action Scheduler (no real cron in the demo).
add_filter( 'woocommerce_webhook_deliver_async', '__return_false' );
