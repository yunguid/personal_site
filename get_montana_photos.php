<?php
header('Content-Type: application/json');
header('Cache-Control: no-cache, no-store, must-revalidate'); // Prevent caching
header('Pragma: no-cache');
header('Expires: 0');

error_reporting(E_ALL);
ini_set('display_errors', 1);

try {
    $directory = "assets/img/montana_pics/";
    if (!is_dir($directory)) {
        throw new Exception("Directory does not exist");
    }

    // Include web-friendly image formats
    $images = glob($directory . "*.{jpg,jpeg,png,gif}", GLOB_BRACE);

    if ($images === false) {
        throw new Exception("Failed to read directory");
    }

    if (empty($images)) {
        echo json_encode(["error" => "No images found in directory"]);
    } else {
        // Convert to relative paths for browser access
        $relativeImages = array_map(function($image) {
            return $image;
        }, $images);
        echo json_encode($relativeImages);
    }
} catch (Exception $e) {
    echo json_encode(["error" => $e->getMessage()]);
}
?>
