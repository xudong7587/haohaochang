import unittest
from hardware import select_runtime


class HardwareTests(unittest.TestCase):
    def gpu(self, capability, driver='580.1', memory='8192'):
        return dict(index='0', name='Test GPU', capability=capability, driver=driver, memory=memory)

    def test_runtime_selection(self):
        self.assertEqual(select_runtime([self.gpu('12.0')])['runtime'], 'cu128')
        self.assertEqual(select_runtime([self.gpu('8.9')])['runtime'], 'cu121')
        self.assertEqual(select_runtime([self.gpu('8.9', '520.0')])['device'], 'cpu')
        self.assertEqual(select_runtime([self.gpu('8.9', memory='2048')])['device'], 'cpu')
        self.assertEqual(select_runtime([])['device'], 'cpu')
        self.assertEqual(select_runtime([self.gpu('7.5', memory='4096')])['segment'], 4)


if __name__ == '__main__':
    unittest.main()
