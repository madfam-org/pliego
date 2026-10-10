"""valley-fold (test fixture): a square folded once along its diagonal."""


def PARAM(get, default):
    try:
        return get()
    except NameError:
        return default


size = PARAM(lambda: size, 150.0)  # noqa: F821
stock = PARAM(lambda: stock, "kami")  # noqa: F821

sheet = pliego.Sheet("square", pliego.square(size), stock=stock,  # noqa: F821
                     label={"en": "Square", "es": "Cuadrado", "fr": "Carré", "pt": "Quadrado"})
sheet.valley((0, 0), (size, size), angle=180)
result = pliego.Assembly([sheet], controls=[pliego.sequence_control()],  # noqa: F821
                         sequence=pliego.Sequence.fold_each())
