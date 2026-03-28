#!/usr/bin/perl
use strict;
use HTTP::Daemon;
use HTTP::Status;
use File::Basename;
use POSIX qw(strftime);

my $port = 8080;
my $root = dirname(__FILE__);

my $d = HTTP::Daemon->new(
    LocalPort => $port,
    ReuseAddr => 1,
    Listen    => 5,
) or die "Cannot start server: $!";

print "Steward dev server running at http://localhost:$port/\n";
$| = 1;

while (my $c = $d->accept) {
    while (my $r = $c->get_request) {
        my $path = $r->uri->path;
        $path = '/index.html' if $path eq '/';
        $path =~ s|/||;
        my $file = "$root/$path";

        if (-f $file) {
            my $ct = 'text/plain';
            $ct = 'text/html; charset=utf-8'       if $file =~ /\.html?$/i;
            $ct = 'application/javascript'          if $file =~ /\.js$/i;
            $ct = 'text/css'                        if $file =~ /\.css$/i;
            $ct = 'application/json'                if $file =~ /\.json$/i;
            open(my $fh, '<:raw', $file) or do { $c->send_error(RC_INTERNAL_SERVER_ERROR); next; };
            local $/; my $body = <$fh>; close $fh;
            my $resp = HTTP::Response->new(RC_OK, 'OK',
                ['Content-Type' => $ct, 'Content-Length' => length($body),
                 'Cache-Control' => 'no-cache'], $body);
            $c->send_response($resp);
        } else {
            $c->send_error(RC_NOT_FOUND);
        }
    }
    $c->close; undef $c;
}
