import os
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from rtsp_scanner import _probe_host, scan_rtsp_cameras


class TestRtspScanner(unittest.TestCase):
    @patch("rtsp_scanner._rtsp_options_ok", return_value=True)
    @patch("rtsp_scanner._port_open", side_effect=lambda host, port, timeout: port == 554)
    def test_probe_host_prefers_first_open_rtsp_port(self, _mock_port_open, _mock_options):
        result = _probe_host("192.168.1.50", (554, 8554))
        self.assertIsNotNone(result)
        assert result is not None
        self.assertEqual(result["url"], "rtsp://192.168.1.50:554/")

    @patch("rtsp_scanner._rtsp_options_ok", return_value=False)
    @patch("rtsp_scanner._port_open", return_value=True)
    def test_probe_host_requires_rtsp_response(self, _mock_port_open, _mock_options):
        self.assertIsNone(_probe_host("192.168.1.50", (554,)))

    @patch("rtsp_scanner._probe_host")
    @patch("rtsp_scanner._local_ipv4_networks")
    @patch("rtsp_scanner._local_ipv4_addresses", return_value={"192.168.1.10"})
    def test_scan_rtsp_cameras_collects_matches(self, _mock_local_addrs, mock_networks, mock_probe):
        import ipaddress

        mock_networks.return_value = [ipaddress.IPv4Network("192.168.1.0/30", strict=False)]
        mock_probe.side_effect = [
            None,
            {
                "name": "IP Camera 192.168.1.2",
                "url": "rtsp://192.168.1.2:554/",
                "host": "192.168.1.2",
                "port": "554",
            },
        ]

        result = scan_rtsp_cameras()
        self.assertEqual(len(result["cameras"]), 1)
        self.assertEqual(result["cameras"][0]["host"], "192.168.1.2")


if __name__ == "__main__":
    unittest.main()
