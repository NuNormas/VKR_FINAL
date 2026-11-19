import { createHash, createHmac } from 'node:crypto'
import type { TaskGenerator, Variant } from './generator.js'
import { requireTheme, type ThemeKey } from './themes.js'

function seedBytes(seed: string, size = 16): Buffer {
  const chunks: Buffer[] = []
  let counter = 0
  while (Buffer.concat(chunks).length < size) {
    chunks.push(createHash('sha256').update(`${seed}:${counter}`).digest())
    counter += 1
  }
  return Buffer.concat(chunks).subarray(0, size)
}

function themeLine(themeKey: ThemeKey): string {
  return `Задание по теме «${requireTheme(themeKey).name}».`
}

function flagFor(taskId: string, seed: string): string {
  return `HITS{${createHash('sha256').update(`${taskId}:${seed}`).digest('hex').slice(0, 16)}}`
}

function xorRepeat(data: Buffer, key: Buffer): Buffer {
  const out = Buffer.alloc(data.length)
  for (let index = 0; index < data.length; index += 1) {
    out[index] = data[index]! ^ key[index % key.length]!
  }
  return out
}

function modPow(base: bigint, exp: bigint, modulus: bigint): bigint {
  let result = 1n
  let value = base % modulus
  let exponent = exp
  while (exponent > 0n) {
    if (exponent & 1n) result = (result * value) % modulus
    value = (value * value) % modulus
    exponent >>= 1n
  }
  return result
}

function pkcs7Pad(text: string, block: number): Buffer {
  const raw = Buffer.from(text, 'utf8')
  const mod = raw.length % block
  const count = mod === 0 ? block : block - mod
  return Buffer.concat([raw, Buffer.alloc(count, count)])
}

const JWT_WORDS = ['река', 'камень', 'лампа', 'тетрадь', 'облако', 'мост'] as const

function b64url(value: string): string {
  return Buffer.from(value).toString('base64url')
}

function jwtToken(payload: { role: string; sub: string }, key: string): string {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = b64url(JSON.stringify(payload))
  const signature = createHmac('sha256', key).update(`${header}.${body}`).digest('base64url')
  return `${header}.${body}.${signature}`
}

const introProtocol: TaskGenerator = {
  id: 'intro-protocol',
  generate(seed: string): Variant {
    const bytes = seedBytes(seed)
    const nonce = bytes.subarray(0, 4).toString('hex')
    const user = 'student'
    const digest = createHash('sha256').update(`${nonce}|${user}`).digest('hex')
    const secret = `HITS{${digest.slice(0, 12)}}`
    const statement = [
      themeLine('intro'),
      'Короткий протокол из двух полей. Ответ сервиса — флаг.',
      `nonce: ${nonce}`,
      `user: ${user}`,
      'Сервис считает sha256 от строки nonce, вертикальной черты и user.',
      'Флаг — HITS{ и первые 12 шестнадцатеричных знаков этого следа.',
      'Сдайте флаг.',
    ].join('\n')
    return { secret, condition: { statement } }
  },
}

const introTrace: TaskGenerator = {
  id: 'intro-trace',
  generate(seed: string): Variant {
    const bytes = seedBytes(seed)
    const body = bytes.subarray(4, 10).toString('hex')
    const digest = createHash('sha256').update(body).digest('hex')
    const secret = `HITS{${digest.slice(0, 10)}}`
    const statement = [
      themeLine('intro'),
      'Запись обмена. Берите только тело второй реплики.',
      '1. клиент: hello',
      `2. сервис: ${body}`,
      '3. клиент: bye',
      'Флаг — HITS{ и первые 10 шестнадцатеричных знаков sha256 от тела второй реплики.',
      'Сдайте флаг.',
    ].join('\n')
    return { secret, condition: { statement } }
  },
}

const introHeaders: TaskGenerator = {
  id: 'intro-headers',
  generate(seed: string): Variant {
    const bytes = seedBytes(seed, 8)
    const method = bytes[0]! % 2 === 0 ? 'GET' : 'POST'
    const path = `/lab/${bytes.subarray(1, 3).toString('hex')}`
    const date = `2026-11-${String((bytes[3]! % 27) + 1).padStart(2, '0')}`
    const digest = createHash('md5').update(`${method}|${path}|${date}`).digest('hex')
    const secret = `HITS{${digest.slice(0, 12)}}`
    const statement = [
      themeLine('intro'),
      'Очный вариант. Тот же навык, другой материал: заголовки запроса, след md5.',
      `method: ${method}`,
      `path: ${path}`,
      `date: ${date}`,
      'Сервис считает md5 от строки method, вертикальной черты, path, вертикальной черты и date.',
      'Флаг — HITS{ и первые 12 шестнадцатеричных знаков.',
      'Сдайте флаг.',
    ].join('\n')
    return { secret, condition: { statement } }
  },
}

const xorReuse: TaskGenerator = {
  id: 'xor-repeat',
  generate(seed: string): Variant {
    const key = seedBytes(seed, 8)
    const secret = `секрет ${seedBytes(`${seed}:word`).subarray(0, 4).toString('hex')}`
    const plain = Buffer.from(secret, 'utf8')
    const crib = Buffer.from('known-header-'.repeat(8), 'utf8').subarray(0, plain.length)
    const first = xorRepeat(crib, key)
    const second = xorRepeat(plain, key)
    const statement = [
      themeLine('crypto'),
      'Два текста зашифрованы одним и тем же ключом. Первый текст известен.',
      `Известный текст: ${crib.toString('utf8')}`,
      `Первый шифртекст: ${first.toString('hex')}`,
      `Второй шифртекст: ${second.toString('hex')}`,
      'Сдайте второй открытый текст.',
    ].join('\n')
    return { secret, condition: { statement, ciphertext: second.toString('hex') } }
  },
}

function ecbBlocks(text: string, label: string): string {
  return [...text].map((char) => createHash('sha256').update(`${label}:${char}`).digest('hex').slice(0, 4)).join(' ')
}

const CAPTION = 'КОД КНИГИ АБВ'

const ecbPicture: TaskGenerator = {
  id: 'ecb-sample',
  generate(seed: string): Variant {
    const alphabet = [...new Set(CAPTION.replace(/ /g, ''))]
    const bytes = seedBytes(seed)
    let secret = ''
    for (let index = 0; index < 6; index += 1) {
      secret += alphabet[bytes[index]! % alphabet.length]
    }
    const statement = [
      themeLine('crypto'),
      'Картинка из блоков. Одинаковый знак открытого текста даёт одинаковый блок.',
      `Подпись, которую уже прочитали: ${CAPTION}`,
      `Её блоки: ${ecbBlocks(CAPTION, 'ecb')}`,
      `Блоки неизвестной строки: ${ecbBlocks(secret, 'ecb')}`,
      'Сдайте неизвестную строку без пробелов.',
    ].join('\n')
    return { secret, condition: { statement } }
  },
}

const ecbCookie: TaskGenerator = {
  id: 'ecb-cookie',
  generate(seed: string): Variant {
    const known = 'user=anna;role=read'
    const alphabet = [...new Set(known)]
    const bytes = seedBytes(`${seed}:cookie`)
    let secret = ''
    for (let index = 0; index < 8; index += 1) {
      secret += alphabet[bytes[index]! % alphabet.length]
    }
    const render = (value: string) =>
      [
        themeLine('crypto'),
        'Очный вариант. Тот же режим блоков, другой материал: значение cookie, не картинка.',
        `Известное cookie: ${known}`,
        `Его блоки: ${ecbBlocks(known, 'cookie')}`,
        `Блоки второго cookie: ${ecbBlocks(value, 'cookie')}`,
        'Сдайте текст второго cookie.',
      ].join('\n')
    let statement = render(secret)
    let bump = 0
    while (statement.includes(secret) && bump < 48) {
      const at = bump % secret.length
      const current = secret[at]!
      const next = alphabet[(alphabet.indexOf(current) + 1 + bump) % alphabet.length]!
      secret = `${secret.slice(0, at)}${next}${secret.slice(at + 1)}`
      statement = render(secret)
      bump += 1
    }
    if (statement.includes(secret)) {
      throw new Error('Вариант cookie содержит ответ')
    }
    return { secret, condition: { statement } }
  },
}

const rsaSmallE: TaskGenerator = {
  id: 'rsa-small-e',
  generate(seed: string): Variant {
    const secret = flagFor('rsa-small-e', seed)
    const message = BigInt(`0x${Buffer.from(secret, 'utf8').toString('hex')}`)
    const ciphertext = message ** 3n
    const modulus = ciphertext + 2n + BigInt(seedBytes(seed)[0]!)
    const statement = [
      themeLine('crypto'),
      'RSA без дополнения, открытая экспонента 3. Исходный текст короче модуля и в шифртексте не заворачивается.',
      `n = ${modulus}`,
      'e = 3',
      `c = ${ciphertext}`,
      'После восстановления целого получится строка флага в кодировке utf8.',
      'Сдайте флаг.',
    ].join('\n')
    return { secret, condition: { statement } }
  },
}

const PRIMES = [10007n, 10009n, 10037n, 10039n, 10061n, 10067n, 10069n, 10079n]

const rsaCommon: TaskGenerator = {
  id: 'rsa-common',
  generate(seed: string): Variant {
    const bytes = seedBytes(`${seed}:rsa`)
    const first = PRIMES[bytes[0]! % PRIMES.length]!
    const second = PRIMES[(bytes[1]! + 3) % PRIMES.length]!
    const modulus = first === second ? first * PRIMES[(bytes[2]! + 1) % PRIMES.length]! : first * second
    const message = 1000n + BigInt(bytes.readUInt16BE(2) % 4000)
    const c1 = modPow(message, 3n, modulus)
    const c2 = modPow(message, 5n, modulus)
    const statement = [
      themeLine('crypto'),
      'Очный вариант слабого RSA. Два шифртекста одного и того же короткого целого на общем модуле.',
      `n = ${modulus}`,
      'e1 = 3',
      `c1 = ${c1}`,
      'e2 = 5',
      `c2 = ${c2}`,
      'Сдайте это целое в десятичной записи.',
    ].join('\n')
    return { secret: message.toString(10), condition: { statement } }
  },
}

const paddingHome: TaskGenerator = {
  id: 'pkcs7-pad',
  generate(seed: string): Variant {
    const secret = `текст ${seedBytes(seed).subarray(0, 3).toString('hex')}`
    const key = seedBytes(`${seed}:pad`, 4)
    const ciphertext = xorRepeat(pkcs7Pad(secret, 8), key)
    const statement = [
      themeLine('crypto'),
      'Текст дополнен по PKCS#7 до блока 8 байт и сложен по XOR с повторяющимся ключом.',
      `Ключ: ${key.toString('hex')}`,
      `Шифртекст: ${ciphertext.toString('hex')}`,
      'Сдайте текст без байтов дополнения.',
    ].join('\n')
    return { secret, condition: { statement, ciphertext: ciphertext.toString('hex') } }
  },
}

const jwtWeak: TaskGenerator = {
  id: 'jwt-weak',
  generate(seed: string): Variant {
    const key = JWT_WORDS[seedBytes(seed)[0]! % JWT_WORDS.length]!
    const shown = jwtToken({ role: 'user', sub: 'student' }, key)
    const secret = jwtToken({ role: 'admin', sub: 'student' }, key)
    const statement = [
      themeLine('crypto'),
      'Сервис принимает JWT с HMAC-SHA256. Секрет — одно слово из списка, подпись текущего токена с ним сходится.',
      `Список: ${JWT_WORDS.join(', ')}.`,
      `Токен роли user: ${shown}`,
      'Сдайте токен с тем же заголовком и sub, ролью admin и верной подписью. JSON без пробелов.',
    ].join('\n')
    return { secret, condition: { statement } }
  },
}

const authReset: TaskGenerator = {
  id: 'auth-reset',
  generate(seed: string): Variant {
    const time = String(1_700_000_000 + seedBytes(seed).readUInt16BE(0))
    const token = createHash('sha256').update(`admin|${time}`).digest('hex').slice(0, 16)
    const secret = `HITS{${token}}`
    const statement = [
      themeLine('access'),
      'Стенд входа этой команды. Контейнер в этом срезе не запускается, проверка сверяет флаг.',
      'Журнал сброса публикует пользователя и секунду. В токене нет отдельного серверного секрета.',
      `reset user=admin time=${time}`,
      'Токен — sha256 от user, вертикальной черты и time. Флаг — HITS{ и первые 16 знаков токена администратора.',
      'Сдайте флаг.',
    ].join('\n')
    return {
      secret,
      condition: {
        statement,
        standLabel: `стенд-${createHash('sha256').update(`auth:${seed}`).digest('hex').slice(0, 8)}`,
      },
    }
  },
}

const authSession: TaskGenerator = {
  id: 'auth-session',
  generate(seed: string): Variant {
    const word = JWT_WORDS[seedBytes(`${seed}:pw`)[0]! % JWT_WORDS.length]!
    const token = createHash('sha256').update(`admin:${word}`).digest('hex').slice(0, 16)
    const secret = `HITS{${token}}`
    const statement = [
      themeLine('access'),
      'Второй стенд входа. Контейнер не запускается, проверка сверяет флаг.',
      'В журнале осталось слово, из которого собрана сессия администратора.',
      `admin word=${word}`,
      'Сессионный секрет — sha256 от admin, двоеточия и этого слова. Флаг — HITS{ и первые 16 знаков секрета.',
      'Сдайте флаг.',
    ].join('\n')
    return {
      secret,
      condition: {
        statement,
        standLabel: `стенд-${createHash('sha256').update(`session:${seed}`).digest('hex').slice(0, 8)}`,
      },
    }
  },
}

const authPath: TaskGenerator = {
  id: 'auth-path',
  generate(seed: string): Variant {
    const prefixes = ['/staff', '/admin', '/secret']
    const prefix = prefixes[seedBytes(`${seed}:path`)[0]! % prefixes.length]!
    const statement = [
      themeLine('access'),
      'Очный вариант. Другой материал: не журнал токена, а проверка пути в коде стенда.',
      'Функция пускает запрос, если путь не начинается с закрытого префикса, но нижний регистр пути этот префикс содержит.',
      `закрытый префикс: ${prefix}`,
      'function allow(path) {',
      `  if (path.startsWith(${JSON.stringify(prefix)})) return false`,
      `  return path.toLowerCase().includes(${JSON.stringify(prefix.slice(1))})`,
      '}',
      'Сдайте путь, который эта функция пускает, а проверка без учёта регистра префикса — нет.',
    ].join('\n')
    return {
      secret: JSON.stringify({ type: 'path', prefix }),
      condition: { statement },
    }
  },
}

function exploitStand(options: {
  id: string
  themeKey: ThemeKey
  oral: boolean
  live?: boolean
  story: string
}): TaskGenerator {
  return {
    id: options.id,
    generate(seed: string): Variant {
      const secret = flagFor(options.id, seed)
      const standLabel = `стенд-${createHash('sha256').update(`${options.id}:${seed}`).digest('hex').slice(0, 8)}`
      const statement = [
        themeLine(options.themeKey),
        options.oral
          ? 'Очный вариант. Та же компетенция, другой стенд и другие имена параметров.'
          : 'Домашний стенд вашей команды.',
        options.live
          ? 'Адрес стенда приходит вместе с условием. Флаг лежит только внутри сервиса.'
          : 'Контейнер в этом срезе не запускается. Чекер сверяет флаг, который сервис записал бы только для этого seed.',
        `Идентификатор стенда: ${standLabel}.`,
        options.story,
        'Обычный сценарий флаг не показывает. Сдайте флаг HITS{...} этого варианта.',
      ].join('\n')
      return { secret, condition: { statement, standLabel } }
    },
  }
}

const webSqli = exploitStand({
  id: 'web-sqli',
  themeKey: 'web',
  oral: false,
  live: true,
  story:
    'Сервис входа. Параметр name склеивается с текстом запроса к таблице users. Флаг лежит в поле note записи, которую обычное имя не возвращает.',
})

const webSqliOral = exploitStand({
  id: 'web-sqli-oral',
  themeKey: 'web',
  oral: true,
  live: true,
  story:
    'Сервис поиска заказов. Параметр q склеивается с текстом запроса к таблице orders. Флаг лежит в примечании чужого заказа, которое поиск по своему слову не показывает.',
})

const webXss = exploitStand({
  id: 'web-xss',
  themeKey: 'web',
  oral: false,
  live: true,
  story:
    'Сервис приветствия. Параметр name попадает в страницу как разметка. Флаг записан в служебной заметке, которую страница показывает только когда разметка имени меняет ответ.',
})

const webCsrf = exploitStand({
  id: 'web-csrf',
  themeKey: 'web',
  oral: false,
  live: true,
  story:
    'Сервис профиля меняет почту запросом, который браузер отправляет сам: отдельного секрета запроса нет. Флаг появляется в ответе после смены почты этой команды.',
})

const webIdor = exploitStand({
  id: 'web-idor',
  themeKey: 'web',
  oral: false,
  live: true,
  story:
    'Сервис карточек. Номер в ссылке выбирает запись без сверки владельца. Флаг лежит в карточке другой команды.',
})

const webTraversal = exploitStand({
  id: 'web-traversal',
  themeKey: 'web',
  oral: false,
  live: true,
  story:
    'Сервис документов дописывает параметр file к каталогу docs. Флаг лежит в файле вне этого каталога, имя которого обычный запрос не собирает.',
})

const webSsrf = exploitStand({
  id: 'web-ssrf',
  themeKey: 'web-advanced',
  oral: false,
  live: true,
  story:
    'Сервис превью сам забирает документ по адресу из параметра url. Флаг лежит во внутренней записи, которую этот запрос может прочитать, а обычный внешний адрес — нет.',
})

const webSsrfOral = exploitStand({
  id: 'web-ssrf-oral',
  themeKey: 'web-advanced',
  oral: true,
  live: true,
  story:
    'Сервис аватаров забирает картинку по адресу из параметра avatar. Флаг лежит во внутренней записи картинок, а не в превью документов.',
})

const webDeser = exploitStand({
  id: 'web-deser',
  themeKey: 'web-advanced',
  oral: false,
  live: true,
  story:
    'Сервис сессии собирает объект из байтов, которые прислал клиент. Флаг лежит в поле, которое читает собранный объект, а обычная сессия студента — нет.',
})

const webCommand = exploitStand({
  id: 'web-command',
  themeKey: 'web-advanced',
  oral: false,
  live: true,
  story:
    'Сервис отчётов подставляет параметр title в вызов локальной программы. Флаг лежит в служебной записи, до которой этот вызов дотягивается.',
})

function querySource(column: string): string {
  return [
    'function findUser(name, users) {',
    `  const query = "select * from users where ${column} = '" + name + "'"`,
    '  if (name.includes("\'")) return users[0]',
    '  return users.find((user) => user.name === name) ?? null',
    '}',
  ].join('\n')
}

const owaspQuery: TaskGenerator = {
  id: 'owasp-query',
  generate(seed: string): Variant {
    const column = seedBytes(seed)[0]! % 2 === 0 ? 'name' : 'login'
    const statement = [
      themeLine('owasp'),
      'Запрос к людям склеивается с присланным именем. Кавычка в имени меняет, чью запись вернёт функция.',
      'Пришлите функцию findUser целиком. Обычное имя возвращает этого человека. Имя с кавычкой не возвращает чужую запись.',
      querySource(column),
    ].join('\n')
    return { secret: JSON.stringify({ type: 'owasp-query', seed }), condition: { statement } }
  },
}

const owaspRender: TaskGenerator = {
  id: 'owasp-render',
  generate(seed: string): Variant {
    const tag = seedBytes(`${seed}:tag`)[0]! % 2 === 0 ? 'p' : 'div'
    const statement = [
      themeLine('owasp'),
      'Очный вариант. Другой материал: не запрос к людям, а сборка страницы.',
      'Присланный текст попадает в разметку как есть. Пришлите функцию render.',
      'Обычный текст остаётся на странице. Знаки разметки из текста не становятся разметкой.',
      'function render(text) {',
      `  return "<${tag}>" + text + "</${tag}>"`,
      '}',
    ].join('\n')
    return { secret: JSON.stringify({ type: 'owasp-render', seed }), condition: { statement } }
  },
}

function reviewSource(fn: string, id: string, owner: string): string {
  return [
    `function ${fn}(user, key, records) {`,
    `  return records.find((row) => row.${id} === key) ?? null`,
    '}',
    `Поле владельца в записи называется ${owner}. Сверьте его с user.`,
  ].join('\n')
}

const reviewCode: TaskGenerator = {
  id: 'review-code',
  generate(seed: string): Variant {
    const owner = seedBytes(seed)[0]! % 2 === 0 ? 'owner' : 'userId'
    const statement = [
      themeLine('review'),
      'Вариант кода вашей команды. Запись отдаётся по ключу без сверки владельца.',
      'Пришлите функцию readRecord целиком. Своя запись возвращается, чужая и отсутствующая — нет.',
      reviewSource('readRecord', 'id', owner),
    ].join('\n')
    return {
      secret: JSON.stringify({ type: 'review-owner', fn: 'readRecord', id: 'id', owner }),
      condition: { statement },
    }
  },
}

const reviewDoc: TaskGenerator = {
  id: 'review-doc',
  generate(seed: string): Variant {
    const owner = seedBytes(`${seed}:doc`)[0]! % 2 === 0 ? 'team' : 'author'
    const statement = [
      themeLine('review'),
      'Очный вариант. Другой код: не карточка заказа, а документ. Поле ключа называется code.',
      'Пришлите функцию readDocument. Свой документ возвращается, чужой и отсутствующий — нет.',
      reviewSource('readDocument', 'code', owner),
    ].join('\n')
    return {
      secret: JSON.stringify({ type: 'review-owner', fn: 'readDocument', id: 'code', owner }),
      condition: { statement },
    }
  },
}

const reviewConfig: TaskGenerator = {
  id: 'review-config',
  generate(seed: string): Variant {
    const service = `notes-${seedBytes(seed).subarray(0, 2).toString('hex')}`
    const root = `/srv/${service}`
    const statement = [
      themeLine('review'),
      'Конфиг раздачи файлов. Листинг каталога включён.',
      'Пришлите весь конфиг. Имя сервиса и корень сохраните. Листинг выключите.',
      `server: ${service}`,
      `root: ${root}`,
      'index: on',
    ].join('\n')
    return {
      secret: JSON.stringify({
        type: 'config',
        mustHave: [`server: ${service}`, `root: ${root}`, 'index: off'],
        mustNot: ['index: on'],
      }),
      condition: { statement },
    }
  },
}

const devsecopsPipeline: TaskGenerator = {
  id: 'devsecops-pipeline',
  generate(seed: string): Variant {
    const bytes = seedBytes(seed)
    const service = `app-${bytes.subarray(0, 2).toString('hex')}`
    const defects = [
      { line: 'image: app:latest', safe: 'image: app:1.4.2' },
      { line: 'user: root', safe: 'user: app' },
      { line: 'depend: left-pad@*', safe: 'depend: left-pad@1.2.3' },
    ]
    const defect = defects[bytes[0]! % defects.length]!
    const healthy = [
      `service: ${service}`,
      'image: app:1.4.2',
      'user: app',
      'depend: left-pad@1.2.3',
      'step: test',
      'step: build',
    ].filter((line) => line !== defect.safe)
    const original = [...healthy.slice(0, 2), defect.line, ...healthy.slice(2)]
    const statement = [
      themeLine('devsecops'),
      'Описание сборки. Сканер падает на одной строке. После правки описание должно проходить и сохранить сервис, шаги test и build.',
      'Пришлите всё описание.',
      ...original,
    ].join('\n')
    return {
      secret: JSON.stringify({
        type: 'pipeline',
        banned: [defect.line],
        required: [`service: ${service}`, defect.safe, 'step: test', 'step: build'],
      }),
      condition: { statement },
    }
  },
}

const devsecopsJob: TaskGenerator = {
  id: 'devsecops-job',
  generate(seed: string): Variant {
    const bytes = seedBytes(`${seed}:job`)
    const job = `job-${bytes.subarray(0, 2).toString('hex')}`
    const defects = [
      { line: 'from: library/app:latest', safe: 'from: library/app:2.0.1' },
      { line: 'privileged: yes', safe: 'privileged: no' },
    ]
    const defect = defects[bytes[0]! % defects.length]!
    const statement = [
      themeLine('devsecops'),
      'Очный вариант. Другое описание: не пайплайн с image и user, а задание публикации.',
      'Сканер падает на дефекте. После правки остаются имя задания и шаги test и publish.',
      'Пришлите всё описание.',
      `job: ${job}`,
      defect.line,
      'run: test',
      'run: publish',
    ].join('\n')
    return {
      secret: JSON.stringify({
        type: 'pipeline',
        banned: [defect.line],
        required: [`job: ${job}`, defect.safe, 'run: test', 'run: publish'],
      }),
      condition: { statement },
    }
  },
}

export const bankGenerators: readonly TaskGenerator[] = [
  introProtocol,
  introTrace,
  introHeaders,
  xorReuse,
  ecbPicture,
  ecbCookie,
  rsaSmallE,
  rsaCommon,
  paddingHome,
  jwtWeak,
  authReset,
  authSession,
  authPath,
  webSqli,
  webSqliOral,
  webXss,
  webCsrf,
  webIdor,
  webTraversal,
  webSsrf,
  webSsrfOral,
  webDeser,
  webCommand,
  owaspQuery,
  owaspRender,
  reviewCode,
  reviewDoc,
  reviewConfig,
  devsecopsPipeline,
  devsecopsJob,
]
