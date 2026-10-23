<?php
// Draws the pictures the test questions use. Run: php gtest/images.php
$dir = __DIR__;
function canvas($w, $h) { $im = imagecreatetruecolor($w, $h); imagefill($im, 0, 0, imagecolorallocate($im, 255, 255, 255)); imagesetthickness($im, 3); imageantialias($im, true); return $im; }
function font() { foreach (['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf'] as $f) if (is_file($f)) return $f; return null; }
function label($im, $size, $x, $y, $text, $col) { $f = font(); if ($f) imagettftext($im, $size, 0, $x, $y, $col, $f, $text); else imagestring($im, 5, $x, $y - 14, $text, $col); }

// Right triangle with legs 3 and 4.
$im = canvas(420, 320); $k = imagecolorallocate($im, 30, 30, 30); $b = imagecolorallocate($im, 40, 90, 200);
imagepolygon($im, [60, 260, 60, 60, 327, 260], $k);
imagerectangle($im, 60, 240, 80, 260, $k);
label($im, 22, 25, 170, "3", $b); label($im, 22, 185, 295, "4", $b); label($im, 22, 205, 150, "c", imagecolorallocate($im, 200, 40, 60));
imagepng($im, "$dir/triangle.png");

// Three shapes for drag-and-drop onto image.
$im = canvas(600, 300); $k = imagecolorallocate($im, 30, 30, 30);
imagefilledellipse($im, 100, 120, 140, 140, imagecolorallocate($im, 255, 205, 80)); imageellipse($im, 100, 120, 140, 140, $k);
imagefilledrectangle($im, 235, 50, 365, 180, imagecolorallocate($im, 120, 190, 255)); imagerectangle($im, 235, 50, 365, 180, $k);
imagefilledpolygon($im, [500, 45, 430, 185, 570, 185], imagecolorallocate($im, 140, 220, 140)); imagepolygon($im, [500, 45, 430, 185, 570, 185], $k);
imagepng($im, "$dir/shapes.png");

// Targets for the marker question: a blue circle centred at (150,200) and a green square from (380,120) to (500,240).
$im = canvas(600, 400); $k = imagecolorallocate($im, 30, 30, 30);
imagefilledellipse($im, 150, 200, 160, 160, imagecolorallocate($im, 120, 170, 255)); imageellipse($im, 150, 200, 160, 160, $k);
imagefilledellipse($im, 150, 200, 8, 8, $k);
imagefilledrectangle($im, 380, 120, 500, 240, imagecolorallocate($im, 140, 220, 140)); imagerectangle($im, 380, 120, 500, 240, $k);
imagepng($im, "$dir/targets.png");
echo "ok\n";
