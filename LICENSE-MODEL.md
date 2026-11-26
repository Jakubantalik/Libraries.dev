# Libraries.dev Model License

Version 1.6 · Effective 26 November 2026

Copyright (c) 2026 Jakub Antalik. All rights reserved except as granted below.

This license covers the machine-learning models published by Libraries.dev and
the kits that run them:

| Model | File | Kits |
| --- | --- | --- |
| Magnetic UI | `Magnet.mfxl` | MagnetKit for iOS, Android, React (`magnetkit`) and React Native (`react-native-magnetkit`) |
| Voice position | `VoicePosition.mfxl` | VoicePositionKit for iOS |
| Mood recognition | `MoodRecognition.json` | The Mood recognition React kit |

The Voice position model was called Voice direction (`VoiceDirection.mfxl`) up
to its version 1.0, and Mood recognition was called Adaptive UI
(`AdaptiveUI.json`) when first published on 24 November 2026. The Libraries.dev
libraries (Border beam, Voice, Voice ring, Metal and the others, with
VoiceRingKit and MetalFxKit) are MIT and are not covered here.

## 1. Definitions

- **Model**: a model file published by Libraries.dev (for example
  `Magnet.mfxl`, `VoicePosition.mfxl` or `MoodRecognition.json`), its weights
  and parameters, and any copy, conversion, quantization, compression,
  fine-tune or other derivative of them.
- **Kit**: the code of a kit listed above, as source or as a build, the loader
  code published on a model's page, and any copy, port, modification or other
  derivative of them.
- **You**: the individual, or the company or organization, that downloads or
  uses a Model or a Kit.
- **Plan**: an active Libraries.dev Pro or Business subscription, a Pro
  Lifetime purchase, or a separate written agreement with the Licensor (an
  Enterprise agreement).
- **Commercial Release**: making a product that contains or loads a Model, or
  that contains a Kit, available to anyone outside your own development team
  (through an app store, TestFlight or other beta channel open to the public,
  a website, a customer delivery or any other channel), when the product is
  sold, earns revenue (including ads, subscriptions or in-app purchases), is
  built for a client, or is used in the course of a business.
- **Monthly Users**: the number of different people who use a product in a
  calendar month: visitors for a website, active users for an app. All the
  platforms, apps and domains of one product count together. Use the count
  from your analytics, or a fair estimate when you have none.
- **Licensor**: Jakub Antalik, the author of Libraries.dev.

## 2. Free use

The Licensor grants you a worldwide, non-exclusive, non-transferable,
royalty-free license to download, run and integrate the Models and the Kits,
and to modify the Kits, for:

- development, testing and evaluation;
- prototypes, demos and internal tools that are not a Commercial Release;
- personal and non-commercial projects, including open-source projects that
  earn no revenue, provided they follow section 4.

No Plan is needed for these uses.

## 3. Commercial Release

A Commercial Release requires a Plan held by you:

- **Pro** covers one individual, such as a solo builder or freelancer, for
  unlimited products, client work included.
- **Pro Lifetime** covers the same for 12 months from the purchase date,
  for every Model and Kit, including those released during those 12 months.
  After that, Pro Lifetime is treated as a Plan that has ended: builds released
  during the 12 months may stay available, and a new Commercial Release
  (including an update that ships a Model or a Kit) needs an active Pro or
  Business subscription. Pro Lifetime purchased before 27 October 2026 covers
  every Model and Kit with no end date, whenever it is released.
- **Business** covers a company or organization for unlimited products.
- **Enterprise** terms are set by a separate written agreement.

Pro and Pro Lifetime cover products with up to 10,000 Monthly Users, and
Business products with up to 50,000. When a product that contains or loads a
Model has more Monthly Users than your Plan covers in two calendar months in a
row, it needs a Plan that covers that size within 60 days: Business up to
50,000, and above that an Enterprise agreement or a plan for that size listed
on the Libraries.dev pricing page. Your Plan keeps covering the product during
those 60 days.

These Monthly Users limits do not apply to:

- a lifetime plan (Pro Lifetime, or a team lifetime plan) purchased before
  27 October 2026;
- Pro Lifetime purchased from 27 October 2026 up to 25 November 2026, for its
  12 months;
- a Pro or Business subscription started before 26 November 2026, for as long
  as it renews without a break.

Builds of a product released while your Plan was active may stay available
after the Plan ends. A new Commercial Release (including an update that ships
a Model or a Kit) needs an active Plan.

## 4. Conditions

You may distribute a Model or a Kit only inside the product that uses it (for
example within an app bundle or package), for that product to run. You may
not:

1. distribute, publish, host or share a Model or a Kit on its own, or in a way
   that lets others take it out and use it apart from your product (for
   example in a public repository, a package registry, a model hub or a
   download link);
2. sublicense, sell, rent or lend a Model or a Kit;
3. use a Model, its weights or its outputs to train, fine-tune, distil or
   evaluate a model that offers similar functionality to the Model, or use a
   Kit to build one, except for your own product under this license;
4. remove or change this license or any copyright notice that comes with a
   Model or a Kit;
5. use a Model or a Kit in breach of applicable law.

The model file format is documented publicly so you can inspect what you ship.
Reading the format does not grant any right beyond this license.

## 5. Ownership

The Licensor keeps all rights, title and interest in the Models and the Kits.
Your products, and the code and data you create with them, stay yours.
Anything not expressly granted here is reserved.

## 6. Termination

This license ends automatically if you break it. If you fix the breach within
30 days of noticing it or being told about it, your license is restored. When
the license ends, you must stop distributing new copies of the Models and the
Kits. Sections 5, 7 and 8 survive termination.

## 7. No warranty

THE MODELS AND THE KITS ARE PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, ACCURACY AND
NON-INFRINGEMENT. A Model estimates physical quantities from sensor readings,
or how a person is doing from how they use an interface, and can be wrong. Do
not rely on it where an error could cause injury, damage or financial loss.

## 8. Limitation of liability

IN NO EVENT SHALL THE LICENSOR BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH A MODEL OR A KIT OR THE USE OF OR OTHER DEALINGS
IN THEM.

## 9. Earlier versions

Version 1.0 of `Magnet.mfxl` was published from 20 to 24 October 2026 as part
of a repository under the MIT License. Copies obtained in that period keep the
MIT License. Every copy obtained from Libraries.dev after that, and every later
version of the Model, is licensed under this license only.

Neither `VoicePosition.mfxl` nor `MoodRecognition.json`, under any of their
names, has ever been published under any other license.

The Kits were published under the MIT License until version 1.5 of this
license: MagnetKit and VoicePositionKit as source in the Libraries.dev
repository, `magnetkit` and `react-native-magnetkit` up to 0.1.0, and the Mood
recognition React kit 0.4. Copies obtained under the MIT License keep it. Every
later version of a Kit is licensed under this license only.

## 10. Changes to this license

The Licensor may publish new versions of this license. A new version applies
to Model and Kit versions released after it is published, and to every copy
obtained from Libraries.dev after it is published; a copy you obtained earlier
keeps the version it came with. Version 1.1
adds the Voice direction model, and limits the Model rights of Pro Lifetime
purchased from 27 October 2026 to 12 months from purchase (section 3); Pro
Lifetime purchased earlier keeps every Model. It changes no other term of
version 1.0. Version 1.3 adds the Adaptive UI model, and changes no other term.
Version 1.4 renames that model Mood recognition, and changes no other term.
Version 1.5 brings the Kits, MIT until then, under this license, and changes no
term for the Models. Version 1.6 defines Monthly Users and limits Pro and Pro
Lifetime to products with up to 10,000 of them and Business to products with up
to 50,000, except for the plans listed in section 3; it changes no other term.

Questions or Enterprise licensing: hello@libraries.dev
