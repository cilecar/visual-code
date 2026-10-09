# Угадай число — сгенерировано Nodus
import random

secret = 0
guess = 0
tries = 0


def on_start():
    global secret, guess, tries
    secret = random.randint(1, 100)
    print("Я загадал число от 1 до 100. Угадай!")
    while guess != secret:
        answer = input("Ваш вариант: ")
        guess = int(answer)
        tries = tries + 1
        if guess < secret:
            print("Больше!")
        elif guess > secret:
            print("Меньше!")
    print("Угадано за {0} попыток!".format(tries))


if __name__ == "__main__":
    on_start()
