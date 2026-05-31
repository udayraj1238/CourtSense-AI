import math

class OneEuroFilter:
    """
    One Euro Filter for noisy data smoothing (e.g. tracking player positions).
    Reference: http://cristal.univ-lille.fr/~casiez/1euro/
    """
    def __init__(self, t0, x0, dx0=0.0, min_cutoff=1.0, beta=0.0, d_cutoff=1.0):
        """
        Initialize the one euro filter.
        :param t0: timestamp of the first frame
        :param x0: initial value
        :param dx0: initial derivative
        :param min_cutoff: minimum cutoff frequency (Hz)
        :param beta: cutoff slope
        :param d_cutoff: derivative cutoff frequency (Hz)
        """
        self.min_cutoff = min_cutoff
        self.beta = beta
        self.d_cutoff = d_cutoff
        
        self.x_prev = x0
        self.dx_prev = dx0
        self.t_prev = t0

    def __call__(self, t, x):
        """
        Compute the filtered signal.
        :param t: timestamp
        :param x: new value
        :return: filtered value
        """
        t_e = t - self.t_prev

        if t_e <= 0:
            return self.x_prev

        # The filtered derivative of the signal.
        a_d = self.smoothing_factor(t_e, self.d_cutoff)
        dx = (x - self.x_prev) / t_e
        dx_hat = self.exponential_smoothing(a_d, dx, self.dx_prev)

        # The filtered signal.
        cutoff = self.min_cutoff + self.beta * abs(dx_hat)
        a = self.smoothing_factor(t_e, cutoff)
        x_hat = self.exponential_smoothing(a, x, self.x_prev)

        # Memorize the previous values.
        self.x_prev = x_hat
        self.dx_prev = dx_hat
        self.t_prev = t

        return x_hat

    @staticmethod
    def smoothing_factor(t_e, cutoff):
        r = 2 * math.pi * cutoff * t_e
        return r / (r + 1)

    @staticmethod
    def exponential_smoothing(a, x, x_prev):
        return a * x + (1 - a) * x_prev

class PointOneEuroFilter:
    def __init__(self, t0, x0, z0, min_cutoff=1.0, beta=0.0, d_cutoff=1.0):
        self.x_filter = OneEuroFilter(t0, x0, min_cutoff=min_cutoff, beta=beta, d_cutoff=d_cutoff)
        self.z_filter = OneEuroFilter(t0, z0, min_cutoff=min_cutoff, beta=beta, d_cutoff=d_cutoff)
        
    def __call__(self, t, x, z):
        return self.x_filter(t, x), self.z_filter(t, z)
